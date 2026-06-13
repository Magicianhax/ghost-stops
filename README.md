# 👻 Ghost Stops

**The trailing stops Solana perps never had — with the trigger logic running on-chain inside a MagicBlock Ephemeral Rollup.**

Built for **Solana Blitz v5** (theme: Trading) · Flash Trade V2 integration

---

## What it does

Every serious trader uses trailing stops: *"follow the price up; if it drops 0.5% from its peak, close me out."* No Solana perps DEX has them — not Flash, not Drift, not Jupiter — because a trailing stop must **recompute on every price tick**, and writing state 10×/second on L1 costs fees forever. So everywhere else, trailing stops run on a private server you have to trust blindly.

Ghost Stops puts the trigger engine **on-chain**:

1. Connect wallet → one signature enables everything (MagicBlock **session key**, scoped + expiring + structurally unable to withdraw).
2. Open a real position on **Flash Trade V2** (which itself runs on MagicBlock's ER — ~30–50ms fills).
3. Attach a trailing stop. An **Order account** is created and delegated to the devnet Ephemeral Rollup.
4. The **ER validator's own crank** calls our program's `tick` every **100ms, fee-free** — reading live **Pyth Lazer** prices pushed into the rollup at 50–200ms — and ratchets the high-water mark *on-chain*. Every tick is a real, inspectable transaction.
5. Price retraces past the trail → order flips to FIRED on-chain → the executor closes the real mainnet position through Flash's API with the session key.

**Measured live, real money:** trigger→fill **841ms** (deterministic test) and **1264ms** (natural fire after 4.5 minutes of on-chain trailing) — vs Flash's native keeper that requires price to hold past a trigger for **8–10 seconds**.

## Why the Ephemeral Rollup is load-bearing (not a checkbox)

| Primitive | How Ghost Stops uses it |
|---|---|
| **Delegation lifecycle** | Order PDAs delegated to the ER (`delegate_order`), mutated at ER speed, state committed back to L1 |
| **Validator cranks** (`ScheduleTask`) | The rollup itself evaluates every order at 100ms — **fee 0, paid by the validator**, no keeper infrastructure. Verified: 10/10 ticks at 100ms cadence |
| **Pricing oracle** | Pyth Lazer prices live inside the ER (feed `ENYweb…4jPu`); our `tick` reads them in-process. Verified identical to Flash's mainnet mark to the 8th decimal |
| **Session keys** (`SessionTokenV2`) | One approval → executor can trade but **cannot withdraw** (withdrawal endpoints reject session signing). Verified on every trading endpoint |
| **Flash V2's own ER** | Execution leg: fills confirm on `flash.magicblock.xyz` in ~450–650ms |

Two Ephemeral Rollups in one product: ours decides, Flash's executes.

## Architecture

```
 Pyth Lazer (50–200ms)
        │
        ▼
┌─────────────────────────── devnet ER (MagicBlock) ───────────────┐
│  oracle feed PDA ──read──▶ ghost_stops::tick  ◀─── validator      │
│                              │ (every 100ms, fee=0)  crank        │
│                              ▼                                    │
│                         Order PDA  (HWM ratchets ON-CHAIN)        │
│                              │ state → FIRED                      │
└──────────────────────────────┼────────────────────────────────────┘
                               │ websocket (account change)
                               ▼
                      executor service ──── control API for the web app
                               │ session-signed close-position
                               ▼
┌────────────────────────── mainnet ────────────────────────────────┐
│   Flash V2 API → Flash's ER (flash.magicblock.xyz) → real fill    │
│   basket / deposits / fills — REAL FUNDS                          │
└────────────────────────────────────────────────────────────────────┘
```

The two programs never CPI into each other — MagicBlock forbids CPI from an ER into non-delegated programs, so the bridge is an off-chain executor *by necessity*, on any cluster. The trigger **decision** is permissionless, deterministic, and fully on-chain; execution uses the same scoped session-key model Flash itself ships.

> Our trigger program runs on the **devnet** ER (the oracle feeds there carry real mainnet Pyth Lazer prices — verified 0.0000% deviation), while all money lives on **mainnet** Flash. A mainnet-ER redeploy is the same code + ~3 SOL of rent.

## Repo layout

| Path | What |
|---|---|
| `programs/ghost-stops` | Anchor program: Order PDAs, `tick` (trailing/fixed state machine), `schedule_tick` (crank via Magic program CPI), delegation, OCO links. Devnet: `y8gjZcwDHqZ8Sz2Uziw5nxr2cWKGyAKaqtNAUJ2mKxh` |
| `services/executor` | Watches order accounts on the ER ws; on FIRED → session-signed `close-position` on Flash; reconcile loop; HTTP control API (`/session`, `/orders`, `/orders/:pda/cancel`) — pays all devnet rent so users never need devnet SOL |
| `apps/web` | Next.js app (built on Flash's MIT tap-trade example): live chart, one-signature enable, tap trading, **Ghost Stops panel** (attach/cancel stops, live HWM + stop level + on-chain tick counter) |
| `packages/flash-v2` | Vendored typed Flash V2 client (MIT, pinned `b8f6759`) |
| `scripts/` | Live probes + integration tests (real lifecycle, session matrix, oracle, crank, end-to-end fills) |
| `docs/research` | Verified ground truth: probe results with signatures, decision brief |

## Run it

```bash
npm install

# 1. executor (holds only scoped session keys; pays devnet rent)
#    .env: PRIVATE_KEY=<base58 devnet-SOL-funded keypair>
npx tsx services/executor/src/index.ts        # control API on :8787

# 2. web app
cd apps/web && npm run dev                     # http://localhost:3000
```

Then: Connect wallet → Enable One-Click Trading (one signature; needs ~$12+ USDC + 0.02 SOL on mainnet) → open a SOL position → **attach a trailing stop** in the Ghost Stops panel → watch the rollup tick it 10×/sec.

Engine unit tests (`vitest`): `npm test` — the TS state machine is an exact integer-math mirror of the on-chain `tick`.

## Trust model

- **Non-custodial throughout.** The executor holds session keys only: scoped to the Flash program, expiring (24h), revocable, and **rejected by withdrawal endpoints** — worst case for a fully compromised executor is closing your position at market, never moving funds.
- The trigger program is permissionless: `tick` takes only the pinned oracle feed; `cancel`/`mark_executed` are gated to owner-or-executor.
- Every trigger decision is an inspectable on-chain transaction with the price that caused it.

## Honest limitations

- SOL market only for now (one live-verified Lazer feed PDA; adding markets = adding feed addresses).
- The browser hands the session key to *our own* executor over HTTPS so stops fire with the tab closed — production would mint the session against an executor-held signer (one extra co-sign round trip).
- Trigger→fill ~1s is bounded by the off-chain hop, which MagicBlock's rules make unavoidable; it is still ~8× faster than Flash's native trigger keeper.
- `flashapi.trade/v2` self-reports `env:"dev"`; client pinned to a vendored commit.

## Verified numbers (all on-chain, reproducible from `docs/research/probe-results.md`)

- Crank cadence: **10/10 ticks at ~100ms, fee = 0** (payer = validator identity)
- Oracle: devnet-ER Lazer feed == Flash mainnet mark to **0.0000%**, sub-second updates
- Session keys: PASS on open / place-trigger / edit-trigger / cancel-trigger / close (438–504ms ER confirms)
- Real fills at oracle: actual entry gap **-0.028%**; round-trip open+close cost **~4bps** (the ±10% you see in quotes is a worst-case display band)
- End-to-end: **841ms / 1264ms** trigger→fill on real $11 mainnet positions

---

Built in a weekend on: [MagicBlock Ephemeral Rollups](https://docs.magicblock.gg) · [Flash Trade V2](https://github.com/flash-trade/examples-v2) · Anchor 0.32 · Next.js 15
