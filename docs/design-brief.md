# Ghost Stops — Product Brief

## What it is

Ghost Stops is a web trading terminal that adds advanced order types — trailing stops, OCO, brackets — to Flash Trade V2, a perpetual-futures DEX on Solana. The trigger logic for these orders runs on-chain inside a MagicBlock Ephemeral Rollup: every order is evaluated by the rollup ~10 times per second against live oracle prices, with no fees and no private server. When an order's condition is met, the position is closed on Flash Trade in about a second through a scoped, non-custodial session key. The user keeps custody of funds at all times.

It is a single-page real-time application: a live price chart fills the screen, with floating chrome (top bar, trade controls, side drawers, modals) layered over it.

## Primary surfaces

**Live price chart (full screen background)**
A continuously updating line of the active market's price, with a price tag pinned at the latest point, a value axis, and — when a position is open — an entry line and a profit/loss shaded band.

**Top bar**
- Market / pair selector showing the active pair and current price.
- A "Ghost Stops" entry that opens the stops drawer, with a badge showing how many stops are currently live.
- A connection/latency indicator with a live status dot and the last on-chain confirm time.
- Wallet segment: when disconnected, a Connect action; when connected, the account balance plus a menu (deposit/withdraw, history, copy address, disconnect).

**Trade terminal (compact panel, expands in place)**
A two-step order setup: first an amount field, then a leverage step (slider, quick presets, and a live fee preview). Completing it arms the buy/sell controls. Collapses to a small summary strip showing fee, size, and leverage.

**Action zone (primary control, bottom)**
A single prominent control whose content depends on account state:
- Connect wallet
- Enable one-click trading
- Deposit funds to start
- A side-by-side SHORT / LONG pair (also operable with arrow keys)
- When in a position: a Close control showing live PnL, plus a Reverse control
A confirmation flash plays on the control when a fill confirms on-chain. No spinners.

**Ghost Stops drawer (side panel)**
- Attach a trailing stop to a live position, choosing a trail distance from presets.
- A list of live orders, each showing the trailed peak, the current stop level, distance to the stop, and a running count of on-chain evaluations.
- An order history list.
- Cancel control per live order.
- Each order carries a status: trailing, fired, executed, cancelled, or failed.

**Market selector drawer (side panel)**
A list of tradeable markets, each with a token icon and the active one marked.

**Sheets / modals (centered dialogs)**
- Enable-trading progress (step-by-step).
- Funds: deposit and withdraw.
- Latency log of measured confirm times.
- History: every confirmed action this session, newest first, each with its confirm time and on-chain signature.
- Position detail: close or reverse an individual position.
- Wallet picker: lists available wallets to connect.

## Key flows

- **Connect:** pick a wallet, then sign a message to prove ownership (free, no transaction).
- **Enable one-click trading:** a single signature sets up the trading account and a session key, so subsequent trades need no popups.
- **Fund:** deposit/withdraw USDC to and from the trading account.
- **Trade:** set amount and leverage, then buy/sell; open, close, or reverse positions; market orders with leverage and optional take-profit/stop-loss.
- **Protect:** attach an on-chain trailing stop or advanced order to a position; watch it trail live; it fires and closes the position automatically.

## States the interface must represent

- Account: disconnected, connecting, loading, connected-but-not-enabled, enabled-but-unfunded, funded-and-flat, position-open, order-attached, order-fired.
- Live indicators: price streaming vs. polling vs. offline; per-order evaluation count; measured latency.
- Empty states: no positions, no active orders, no history yet.
- Per-order status: trailing, fired, executed, cancelled, failed.
- Real-time values throughout: price, position PnL and liquidation level, order peak/stop/distance, confirm times.

## Content types

- Many numeric, frequently-updating values (prices, sizes, PnL, distances, latencies) that benefit from tabular alignment.
- Short status labels and badges.
- Wallet addresses and transaction signatures (truncated, copyable).
- Dense lists (orders, history, markets).
- A few short instructional/explanatory lines.
