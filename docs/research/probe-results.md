# Probe Results (live, mainnet, 2026-06-13)

Owner: `FsQNzKG2Mf7jrvGvRbqXFKoi8FoySUCiVsAoZgQ3NG6P` · Basket: `9Zu64drGZjYsPAPz8cN7buzPob4LsZvcD5g7htLyZQcj`

## Probe A — full Flash V2 lifecycle ✅

| Step | Chain | Confirm time | Signature |
|---|---|---|---|
| init-basket | BASE | 1269ms | `3qJWBSjh…baGF` |
| init-deposit-ledger | BASE | 1070ms | `3QksVrLu…UYu5` |
| delegate-basket | BASE | 785ms | `5nd6hjbJ…1qDp` |
| deposit-direct 15 USDC | BASE | 784ms | `3WvTgtFe…GzLM4` |
| open-position $11 × 1.1x LONG | **ER** | **626ms** | `2QAExsLA…3QL6g` |
| close-position (full) | **ER** | **446ms** | `4nCFpzDc…Rwv3v` |

## Key findings

1. **The ±10% quote gap is a DISPLAY-ONLY worst-case price band.** Quotes show `newEntryPrice = oracle × 1.10` (LONG) / `× 0.90` (SHORT) constant across leverage (1.1–5x), size ($11–$100), and slippage (0.1–0.5). The liq price and `settledPnl`/`receiveTokenAmountUi` in quotes are derived from the same band.
   - **ACTUAL fill:** entry $67.23 vs mark $67.2486 → **-0.028% gap**. Fills happen at oracle.
   - **ACTUAL settle:** deposited 15, opened+closed $11 collateral round trip → basket `debits` 11.000000, `pendingCredits` 10.995447 → **real round-trip cost ≈ $0.0046 (~4 bps)**, vs quote's claimed -$1.10. Settlement happens at oracle.
2. **ER trading is fast:** open confirmed 626ms, close 446ms wall-clock from Windows box (incl. network distance, ~2 wire trips).
3. **Close proceeds land as `pendingCredits`** on the basket (settle ~10s) — available balance accounting must include them.
4. Entry fee at 1.1x: $0.00; at 5x: $0.01 on $55 notional (~2bps). Borrow 0.00047%/h.
5. Setup steps idempotence: fresh-owner detection via `owner()` works (`basketPubkey` null → run setup).

## Probe B — session-key capability matrix ✅

Session: `Fz7Nc2LeJxx6mTpUc3xWV5Pjk3vurizaN2LCrmHZifW5` (createSessionV2, 24h, 0.01 SOL top-up, base chain).

| Endpoint (session-signed, ER) | Result |
|---|---|
| open-position | **PASS** (1780ms) |
| place-trigger-order (SL) | **PASS** (442ms) |
| edit-trigger-order | **PASS** (438ms) |
| cancel-trigger-order (orderId 0) | **PASS** (442ms) |
| place-trigger-order (TP) | **PASS** (442ms) |
| close-position | **PASS** (504ms) |
| Flash keeper auto-execution | **INCONCLUSIVE** — mark never crossed the TP during the 120s window; irrelevant to our architecture (executor self-closes) |

**Decision:** executor gets full session-key capability — open/trigger-CRUD/close all work without the wallet. Optional safety feature unlocked: maintain a native Flash SL as a trailing backstop (edit-trigger-order works session-signed) in case the executor dies.

## Probe C — devnet crank + oracle ✅

**Oracle (devnet ER, `ENYweb…4jPu`):** live, updates between 2s-apart reads, and matches Flash's mainnet mark to **0.0000%** (raw `6658154361` × 10⁻⁸ = $66.5815 == Flash $66.58154361). Layout confirmed: price i64-LE @ byte 73, exponent i32-LE @ byte 89 — **stored as +8 but means 10⁻⁸** (use −|exp| for display; on-chain logic compares raw i64s only).

**Crank (devnet ER):** `ScheduleTask` (Magic program variant 6) accepted; **10/10 iterations executed at ~100ms cadence** (consecutive slots ~2 apart), every tx `ok`, **fee = 0, payer = the validator identity itself** (`MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`). Crank-executor PDA: seeds `["crank-executor", payer]` under `Crank111…`.

**Phase 0 conclusion: every architectural assumption is verified live. Build proceeds with no fallbacks needed.**
