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

## Probe B — session-key capability matrix

(pending)

## Probe C — devnet crank + oracle

(pending)
