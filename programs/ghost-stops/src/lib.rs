use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};

declare_id!("y8gjZcwDHqZ8Sz2Uziw5nxr2cWKGyAKaqtNAUJ2mKxh");

pub const ORDER_SEED: &[u8] = b"order";

/// Pyth Lazer price layout inside MagicBlock oracle feed PDAs (verified live):
/// price = i64-LE at byte 73. Trailing logic compares RAW i64s only — the
/// exponent is constant per feed, so it never enters the math.
pub const FEED_PRICE_OFFSET: usize = 73;

#[ephemeral]
#[program]
pub mod ghost_stops {
    use super::*;

    /// Create an order PDA on the BASE layer (devnet). Delegation happens in
    /// `delegate_order`; from then on all mutations run inside the ER.
    /// `owner` is NOT a signer: the executor service creates orders on behalf
    /// of users (it pays devnet rent; users never need devnet SOL). The worst
    /// an arbitrary creator can do is attach a stop that closes a position
    /// through the owner's own scoped session — and cancel/mark stay gated.
    pub fn create_order(ctx: Context<CreateOrder>, p: CreateOrderParams) -> Result<()> {
        require!(p.trailing_bps > 0 || p.kind == OrderKind::FixedTrigger as u8, GhostError::BadParams);
        require!(p.kind <= OrderKind::FixedTrigger as u8, GhostError::BadKind);
        let o = &mut ctx.accounts.order;
        o.owner = ctx.accounts.owner.key();
        o.executor = p.executor;
        o.order_id = p.order_id;
        o.kind = p.kind;
        o.market_symbol = p.market_symbol;
        o.price_feed = p.price_feed;
        o.trailing_bps = p.trailing_bps;
        o.high_water_mark = p.initial_price;
        o.trigger_price = p.trigger_price;
        o.trigger_above = p.trigger_above;
        o.size_pct_bps = p.size_pct_bps;
        o.oco_link = p.oco_link;
        o.expiry = p.expiry;
        o.state = OrderState::Active as u8;
        o.fired_price = 0;
        o.is_long = p.is_long;
        o.bump = ctx.bumps.order;
        Ok(())
    }

    /// Delegate the order PDA to the ER (BASE layer tx). Validator optionally
    /// pinned via the `validator` account; all of one tx's writable accounts
    /// must live on the same validator.
    pub fn delegate_order(ctx: Context<DelegateOrder>, owner: Pubkey, order_id: u64) -> Result<()> {
        ctx.accounts.delegate_order(
            &ctx.accounts.payer,
            &[ORDER_SEED, owner.as_ref(), &order_id.to_le_bytes()],
            DelegateConfig {
                validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// The heartbeat. Permissionless BY DESIGN: its only inputs are the pinned
    /// oracle feed and deterministic state transitions — extra calls are
    /// harmless. The validator crank invokes this every N ms inside the ER.
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        let o = &mut ctx.accounts.order;
        require!(o.state == OrderState::Active as u8, GhostError::NotActive);
        require_keys_eq!(ctx.accounts.price_feed.key(), o.price_feed, GhostError::WrongFeed);

        let data = ctx.accounts.price_feed.try_borrow_data()?;
        require!(data.len() >= FEED_PRICE_OFFSET + 8, GhostError::BadFeed);
        let price = i64::from_le_bytes(
            data[FEED_PRICE_OFFSET..FEED_PRICE_OFFSET + 8].try_into().unwrap(),
        );
        require!(price > 0, GhostError::BadFeed);

        let now = Clock::get()?.unix_timestamp;
        if o.expiry > 0 && now > o.expiry {
            o.state = OrderState::Cancelled as u8;
            return Ok(());
        }

        match o.kind {
            k if k == OrderKind::TrailingStop as u8 => {
                if o.is_long {
                    if price > o.high_water_mark {
                        o.high_water_mark = price;
                    }
                    let stop = o.high_water_mark - o.high_water_mark / 10_000 * (o.trailing_bps as i64);
                    if price <= stop {
                        o.state = OrderState::Fired as u8;
                        o.fired_price = price;
                    }
                } else {
                    if price < o.high_water_mark {
                        o.high_water_mark = price;
                    }
                    let stop = o.high_water_mark + o.high_water_mark / 10_000 * (o.trailing_bps as i64);
                    if price >= stop {
                        o.state = OrderState::Fired as u8;
                        o.fired_price = price;
                    }
                }
            }
            k if k == OrderKind::FixedTrigger as u8 => {
                let crossed = if o.trigger_above { price >= o.trigger_price } else { price <= o.trigger_price };
                if crossed {
                    o.state = OrderState::Fired as u8;
                    o.fired_price = price;
                }
            }
            _ => return err!(GhostError::BadKind),
        }
        Ok(())
    }

    /// Schedule the validator crank that calls `tick` every `interval_ms`
    /// inside the ER (send this tx to the ER). Re-scheduling the same task_id
    /// replaces the task — that's the native amend primitive.
    pub fn schedule_tick(ctx: Context<ScheduleTick>, args: ScheduleTickArgs) -> Result<()> {
        let tick_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.order.key(), false),
                AccountMeta::new_readonly(ctx.accounts.price_feed.key(), false),
            ],
            data: anchor_lang::InstructionData::data(&crate::instruction::Tick {}),
        };
        let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
            task_id: args.task_id as i64,
            execution_interval_millis: args.interval_ms as i64,
            iterations: args.iterations as i64,
            instructions: vec![tick_ix],
        }))
        .map_err(|_| error!(GhostError::SerializeFailed))?;

        let schedule_ix = Instruction::new_with_bytes(
            MAGIC_PROGRAM_ID,
            &ix_data,
            vec![
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new(ctx.accounts.order.key(), false),
                AccountMeta::new_readonly(ctx.accounts.price_feed.key(), false),
            ],
        );
        invoke(
            &schedule_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.order.to_account_info(),
                ctx.accounts.price_feed.to_account_info(),
            ],
        )?;
        Ok(())
    }

    /// Cancel a scheduled crank task (ER tx). Verified encoding: variant 7 + i64 task_id.
    pub fn cancel_tick(ctx: Context<CancelTick>, task_id: u64) -> Result<()> {
        let mut data = Vec::with_capacity(12);
        data.extend_from_slice(&7u32.to_le_bytes());
        data.extend_from_slice(&(task_id as i64).to_le_bytes());
        let ix = Instruction::new_with_bytes(
            MAGIC_PROGRAM_ID,
            &data,
            vec![AccountMeta::new(ctx.accounts.payer.key(), true)],
        );
        invoke(&ix, &[ctx.accounts.payer.to_account_info()])?;
        Ok(())
    }

    /// Owner or executor cancels an active order (ER tx).
    pub fn cancel_order(ctx: Context<GatedMutate>) -> Result<()> {
        let o = &mut ctx.accounts.order;
        require!(o.state == OrderState::Active as u8, GhostError::NotActive);
        require!(
            ctx.accounts.signer.key() == o.owner || ctx.accounts.signer.key() == o.executor,
            GhostError::Unauthorized
        );
        o.state = OrderState::Cancelled as u8;
        Ok(())
    }

    /// Executor (or owner) reports the Flash fill outcome (ER tx).
    pub fn mark_executed(ctx: Context<GatedMutate>, success: bool) -> Result<()> {
        let o = &mut ctx.accounts.order;
        require!(o.state == OrderState::Fired as u8, GhostError::NotFired);
        require!(
            ctx.accounts.signer.key() == o.owner || ctx.accounts.signer.key() == o.executor,
            GhostError::Unauthorized
        );
        o.state = if success { OrderState::Executed as u8 } else { OrderState::Failed as u8 };
        Ok(())
    }

    /// Commit final state to L1 and undelegate (ER tx) — the "settle" moment.
    pub fn undelegate_order(ctx: Context<UndelegateOrder>) -> Result<()> {
        {
            let o = &ctx.accounts.order;
            require!(
                ctx.accounts.payer.key() == o.owner || ctx.accounts.payer.key() == o.executor,
                GhostError::Unauthorized
            );
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.order.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateOrderParams {
    pub order_id: u64,
    pub kind: u8,
    pub market_symbol: [u8; 8],
    pub price_feed: Pubkey,
    pub trailing_bps: u16,
    pub initial_price: i64,
    pub trigger_price: i64,
    pub trigger_above: bool,
    pub size_pct_bps: u16,
    pub oco_link: Option<Pubkey>,
    pub expiry: i64,
    pub is_long: bool,
    pub executor: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScheduleTickArgs {
    pub task_id: u64,
    pub interval_ms: u64,
    pub iterations: u64,
}

#[repr(u8)]
pub enum OrderKind {
    TrailingStop = 0,
    FixedTrigger = 1,
}

#[repr(u8)]
pub enum OrderState {
    Active = 0,
    Fired = 1,
    Executed = 2,
    Cancelled = 3,
    Failed = 4,
}

#[account]
pub struct Order {
    pub owner: Pubkey,
    pub executor: Pubkey,
    pub order_id: u64,
    pub kind: u8,
    pub market_symbol: [u8; 8],
    pub price_feed: Pubkey,
    pub trailing_bps: u16,
    pub high_water_mark: i64,
    pub trigger_price: i64,
    pub trigger_above: bool,
    pub size_pct_bps: u16,
    pub oco_link: Option<Pubkey>,
    pub expiry: i64,
    pub state: u8,
    pub fired_price: i64,
    pub is_long: bool,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(p: CreateOrderParams)]
pub struct CreateOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the basket owner the order protects; not required to sign —
    /// see create_order doc comment for the trust argument.
    pub owner: AccountInfo<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 220,
        seeds = [ORDER_SEED, owner.key().as_ref(), &p.order_id.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, Order>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(owner: Pubkey, order_id: u64)]
pub struct DelegateOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the Order PDA being delegated
    #[account(mut, del, seeds = [ORDER_SEED, owner.as_ref(), &order_id.to_le_bytes()], bump)]
    pub order: AccountInfo<'info>,
    /// CHECK: optional validator identity to pin the delegation to
    pub validator: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut)]
    pub order: Account<'info, Order>,
    /// CHECK: validated against order.price_feed; MUST be read-only in the tx
    pub price_feed: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ScheduleTick<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the delegated Order PDA the crank will mutate
    #[account(mut)]
    pub order: AccountInfo<'info>,
    /// CHECK: oracle feed, read-only
    pub price_feed: AccountInfo<'info>,
    /// CHECK: MagicBlock system program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CancelTick<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: MagicBlock system program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct GatedMutate<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub order: Account<'info, Order>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub order: Account<'info, Order>,
}

#[error_code]
pub enum GhostError {
    #[msg("order is not active")]
    NotActive,
    #[msg("wrong price feed for this order")]
    WrongFeed,
    #[msg("malformed price feed account")]
    BadFeed,
    #[msg("unknown order kind")]
    BadKind,
    #[msg("order has not fired")]
    NotFired,
    #[msg("invalid order parameters")]
    BadParams,
    #[msg("signer is neither owner nor executor")]
    Unauthorized,
    #[msg("failed to serialize crank instruction")]
    SerializeFailed,
}
