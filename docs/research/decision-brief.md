# Blitz v5 Decision Brief — Synthesis Lead → Team Lead

**Date:** 2026-06-12 (hackathon runs Jun 12–14). All facts below were verified by researchers in the last 24h unless marked UNVERIFIED.

---

## 1. Ground truth

1. **Flash V2 IS MagicBlock-native and is the blessed hackathon surface.** Flash's V2 "magic-trade" program (`FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV`) runs on Flash's dedicated ER at `https://flash.magicblock.xyz` (~30–50ms fills, 10s commits). Public REST API at `https://flashapi.trade/v2` (36 endpoints, no auth), live-probed today. The starter repo `flash-trade/examples-v2` was created 2026-06-11 *for this hackathon* and states verbatim: building on V2 through it qualifies for ER eligibility + the 50% Flash prize match. — https://github.com/flash-trade/examples-v2 (README, network.ts)

2. **Non-custodial programmatic trading on Flash V2 is solved via MagicBlock session keys.** Every V2 trading request type (Open/Close/ReversePosition, Place/Edit/CancelTriggerOrder, PlaceTpSl, limit orders) accepts optional `signer + sessionToken`; withdrawal endpoints do NOT. One wallet approval mints a scoped, expiring, revocable `SessionTokenV2` (program `KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5`); a server engine holding only the session key can trade but structurally cannot exfiltrate funds. — https://github.com/flash-trade/examples-v2/blob/main/packages/flash-v2/src/types.ts and examples/tap-trade/SESSION-KEYS.md

3. **Flash devnet is dead for trading. Demo runs on mainnet with real funds.** Devnet pools exist but on-chain oracles were last published 2026-05-11 (~32 days stale) against `maxPriceAgeSec=100`; the backup-oracle bypass needs Flash's private key; no collateral faucet. examples-v2 README: "Mainnet. Real funds." Budget: ~$25–30 USDC; positions need **≥$11 collateral** for TP/SL eligibility. — live devnet RPC decode + https://github.com/flash-trade/examples-v2/blob/main/GOTCHAS.md

4. **The order-type gap is real and verified.** Flash natively has only market, limit-entry, and TP/SL triggers — **no trailing stops, no OCO, no scaled exits** — and its keeper is weak (price must hold past trigger 8–10s; guaranteed execution capped at 25 orders/market/day). No Solana perp DEX (Drift, Jupiter) has trailing stops either. — https://docs.flash.trade/flash-trade/flash-trade-protocol/perpetuals-specifications/stop-loss-take-profit-orders.md

5. **Oracle-inside-ER: live and verified on all six hosted validators.** MagicBlock's pricing oracle (`PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`) pushes Pyth Lazer prices into ER-resident PDAs at 50–200ms (SOL/USD = `ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu`; price = i64 at byte offset 73). Empirically confirmed updating sub-second on devnet AND mainnet ERs today. Feeds are "any-validator" delegated → readable on whichever node holds your PDAs, in one transaction. — https://docs.magicblock.gg/pages/tools/oracle/implementation.md + live getAccountInfo probes

6. **You can never CPI into Flash from inside an ER.** Hard rule from the FAQ: only delegated accounts are writable in an ER; programs are cloned, never delegated; you cannot delegate Flash's accounts. Trigger *decisions* live in the ER; *execution* must land on the layer where Flash state lives. — https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/faq.md

7. **Cranks run on hosted devnet, mainnet, AND TEE validators — verified empirically today.** Min interval 10ms; per-tick cost zero (validator-paid, observed fee=0); CancelTask works; same-task_id reschedule = replace (native amend primitive). "Your stop is evaluated every 100ms by the rollup itself, no keeper" is literally true. None of this is documented — source code + live tests only. — live ScheduleTask tests on devnet/mainnet/devnet-tee.magicblock.app + magicblock-validator source

8. **Magic Actions CAN reach third-party programs — but the only signer is the escrow PDA.** The `ScheduleIntentBundle` path (current SDK) allows any `destination_program`; the destination sees exactly one signer: the user's delegation-program escrow PDA. The user's wallet can never sign post-commit, and a session key can't either. **Consequence: atomic ER-trigger→Flash-fill via Magic Action only works if the Flash position is owned by a PDA — incompatible with normal user baskets.** Also: any action failure reverts the entire commit, no retries. — delegation-program + magicblock-validator source (read locally)

9. **Delegation lifecycle constraints:** delegate on base RPC, operate on ER RPC (`skipPreflight: true`); unpinned delegation defaults to the **Singapore** validator (`MAS1...`) — pin `DelegateConfig.validator` explicitly (e.g., US `MUS3...`); all writable accounts in one tx must be delegated to the SAME validator; oracle feeds must be passed READ-ONLY or the router hard-errors. ER txs free; 0.0001 SOL/commit (10 sponsored), 0.0003 SOL at undelegation. — https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart + magic-router source

10. **V2 WebSocket verified live:** `wss://flashapi.trade/v2/owner/{owner}/ws?updateIntervalMs=100..10000` streams any owner's basket + PnL/liq metrics, no auth (5 conns/owner). One-shot `GET /v2/owner/{owner}` is the polling fallback. — live connection test + examples-v2 owner-stream.ts

11. **Copy trading is already Flash's own example.** `examples-v2/examples/copy-trade` ships WS diffing → OPEN/GROW/SHRINK/CLOSE mirroring. The README's suggested first AI prompt is literally "build me a trailing-stop bot" — anticipated but NOT implemented. — https://github.com/flash-trade/examples-v2/blob/main/examples/copy-trade/README.md

12. **Judging signal from 5 prior Blitz editions:** every winner used a named MagicBlock primitive load-bearingly (delegation, Private ER, crank, VRF), shipped live URL + GitHub + demo video; criteria "depth of integration, creativity, polish"; v5 is community-voted, "working demos win." Trailing stops/OCO are NOT on MagicBlock's official v5 idea list (creativity points); copy trading IS (crowded). — https://x.com/magicblock/status/2026678583502962725 et al.

13. **Private ERs (TEE) are live on devnet+mainnet and cranks work inside them** (verified). BUT: the permission flags cover tx logs/balances/messages/signatures — **whether raw account DATA is hidden from non-members is UNVERIFIED**, and committed state becomes public on L1 regardless. — https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/access-control + live TEE crank test

14. **API sharp edges (GOTCHAS.md is the real manual):** zero server-side trigger-price validation (on-chain error 6057); edit-trigger-order requires BOTH price and size; cancel orderId 255 = cancel all; ≥97% close = full close; errors returned as `err` inside HTTP 200; trades use ER blockhash, setup/withdrawals use base RPC; withdrawals two-phase (30–90s). — https://github.com/flash-trade/examples-v2/blob/main/GOTCHAS.md

15. **Trigger→settlement latency is UNDOCUMENTED.** Source analysis says commit+finalize+undelegate(+actions) packs into one L1 tx when small → estimate ~1–2.5s trigger-to-settled. Nobody has measured it. Still beats Flash's 8–10s keeper hold, but measure before putting a number on a slide. — magicblock-committor-service source

---

## 2. Candidate products

### A. "Ghost Stops" — ER-native advanced order engine for Flash V2 (trailing stops, OCO, brackets, breakeven-move)

**Architecture.** User signs ONE enable bundle: `createSessionV2` (scoped to magic-trade, 24h) + init-basket + init-deposit-ledger + delegate-basket + deposit USDC — standard Flash V2 lifecycle, base RPC. Your own Anchor program owns **Order PDAs** (trailing %, high-water mark, OCO leg pairs, time-stops) delegated to a pinned MagicBlock ER validator. A **crank** (ScheduleTask, 100ms, validator-paid, zero cost) runs a tick instruction that reads the Pyth Lazer feed PDA (read-only) + mutates the order PDA — high-water mark ratchets fully on-chain inside the ER. On trigger, the program flips order state to FIRED and commits; a **thin executor service** (or the user's open browser) watching the ER via WebSocket immediately POSTs session-signed `close-position`/`edit-trigger-order` to flashapi.trade and submits to Flash's ER (`flash.magicblock.xyz`). Execution is gasless, ~30–50ms, non-custodial (session key can't withdraw). Data flow: Pyth Lazer → MagicBlock oracle PDA (in ER) → crank tick → order PDA → WS → executor → Flash V2 ER → L1 commit every 10s.

- **Real-data story:** real mainnet Flash positions, real Pyth Lazer prices at 50ms cadence, real fills. Zero mocks.
- **Weekend feasibility:** HIGH. Order program = anchor-counter skeleton + crank-counter + oracle consumer (~1 day). Executor + Flash client = 0.5 day (examples-v2 typed client is MIT, clone it). UI = 1 day (fork roll-dice Next.js app or tap-trade).
- **ER load-bearing-ness: MAXIMUM.** Two layers of ER: Flash V2's own ER for execution AND your own delegated program with crank-driven trigger evaluation — the only design that shows the full primitive set (delegation lifecycle, crank, oracle, commit).
- **Flash integration depth:** deep — session keys, basket lifecycle, trigger/close endpoints, WS. +50% match native.
- **Judge appeal:** highest. Fills a verified gap no Solana perp DEX has, directly fixes Flash's weakest documented subsystem, NOT on the official idea list, and the demo writes itself (drag a stop line; watch the rollup tick it 10x/sec; price crosses; fill lands in ~1s vs Flash's 8–10s).
- **Honest caveat:** the trigger→execution hop is off-chain (executor with session key), not atomic. The atomic Magic-Action path doesn't work for user-owned baskets (fact #8). Pitch it as "decision on-chain in ER at 100ms; execution via scoped session key" — that's accurate and Flash itself ships the same signing model.

### A′ (variant). Hidden stops in a Private ER (TEE)

Same as A, but order PDAs delegated to `devnet-tee`/`mainnet-tee` with `set_privacy` — "your stop levels are invisible until they fire." Cranks verified working in TEE. **Do not make this the core**: whether account *data* is actually hidden from non-member reads is UNVERIFIED, and committed state leaks on L1. Spend max 1 hour testing on devnet-tee; ship it as a togglable bonus feature if it passes, drop silently if not.

### B. Copy trading

**Architecture:** WS-subscribe leader baskets, diff into events, mirror via session-signed open/close sized by collateral ratio. **Kill reasons:** Flash ships this as an official example (judges will diff your code against the starter); it's on MagicBlock's idea list (crowded); ER usage is least load-bearing (the engine is a plain web service). Only viable as a 2-hour bolt-on feature ("mirror any of the 753 live baskets"), not a product.

### C. PvP trading arena

**Architecture:** match-state PDAs in ER, players take real $11 Flash positions, live PnL scoring from `/v2/owner/{owner}`, VRF for matchmaking, ephemeral accounts for session state, settle stakes on commit. **Feasibility:** medium-high (rock-paper-scissor example + WS PnL gets you 70%). **Kill reasons:** MagicBlock gaming fatigue (v0/v1 winners were games), looser fit to "breakout trading app" theme, Flash integration is shallow (read-only PnL). Fallback only.

### D. Private DEX / dark orders via Private Payments API

On the official idea list, hosted API exists (payments.magicblock.app, Jupiter passthrough + delayed split transfers). **Kill reasons:** mainnet-only Jupiter spot (not Flash → likely loses the +50%), the privacy thread was already mined in v2/v3 (privRoll, Loofta, Veil), and the core engineering is calling a hosted API — thin technical depth. Not recommended.

---

## 3. Hard risks

**Idea A (Ghost Stops):**
- **Session-key honoring on trigger endpoints is UNVERIFIED at runtime.** types.ts declares `signer+sessionToken` on all trading endpoints, but GOTCHAS only explicitly confirms parsing for open/close/collateral/reverse; malformed session fields silently fall back to owner-signing. **Test hour 1.** If trigger endpoints reject session signing, fall back to engine self-closing positions (close-position IS confirmed session-capable) — product survives.
- **Whether ER-placed trigger orders auto-execute** (Flash bots) or need your executor to close is unknown — decides editor-only vs editor+executor engine. Test hour 1; ask MightieMags at the kickoff AMA (today 15:00 UTC).
- **API stability:** flashapi.trade/v2 reports `env:"dev"`, repo is 1 day old and was pushed today. Pin a commit, vendor openapi.v2.json. Endpoints could shift mid-weekend.
- **REST rate limits on /v2 undocumented** — lean on the WS, not polling.
- **Crank rate-limiting/anti-abuse on hosted nodes undocumented** — many 10ms tasks per authority could get throttled; 100ms cadence for the demo is safe-feeling but unguaranteed.
- **Funds:** mainnet-only; ~$25–30 USDC + 0.05 SOL needed from hour zero; every test fill costs real fees/spread (one researcher saw an unexplained ~10% entry-vs-oracle gap on a 5x quote — verify spread with small quotes before sizing).
- **Cancel/replace races in fast markets** untested (edit needs both price+size; orderId 255 nukes all triggers per market).

**Idea A′ (privacy variant):** account-data hiding UNVERIFIED; commit leaks state; Magic Actions inside TEE untested end-to-end. Bonus-feature risk only if scoped as such.

**Idea B:** originality is dead on arrival (official example). No additional technical risk — that's the problem.

**Idea C:** real-money PvP stakes + escrow inside ER (whether ER txs can move delegated SPL/lamport stakes is partially unverified); weakest theme fit; judge fatigue.

**Cross-cutting:** mainnet ER runs 0.12.1 vs devnet 0.12.3 (minor skew); commit-fee payer on mainnet unverified; trigger→fill latency unmeasured (don't claim a number you haven't timed).

---

## 4. Recommendation

**Build A: "Ghost Stops" — trailing stops / OCO / bracket engine for Flash V2, with your own crank-driven trigger program on a MagicBlock ER and session-key execution.** It is the only candidate that is simultaneously: a verified real gap (no Solana perp DEX has it), off MagicBlock's idea list (creativity), maximally ER-load-bearing (two ERs: yours + Flash's), deeply Flash-integrated (+50%), non-custodial (survives judge probing), and assemblable from working example code (anchor-counter + crank-counter + oracle consumer + examples-v2 client). Add the TEE hidden-stops variant only if the 1-hour privacy test passes.

**Fallback (if your own ER program stalls by Saturday noon):** pure-service trailing-stop/OCO engine on Flash V2 — WS price/position feed in, session-signed edit/close out. Still ER-eligible per the README (basket delegated, trades execute on Flash's ER), still +50%, still fills the gap. You lose the crank showpiece, not the product.

**First 5 build steps (tonight):**

1. **Fund + lifecycle (1h):** Fund a wallet with $30 USDC + 0.05 SOL mainnet. Clone `flash-trade/examples-v2` (pin commit), run the full V2 lifecycle: create-session → init-basket → init-deposit-ledger → delegate-basket → deposit → open one $11 SOL long with TP/SL → close. Confirms every assumption about the execution leg.
2. **Session-key probe (1h, decides engine architecture):** With ONLY the session key, attempt place-trigger-order → edit-trigger-order → close-position. Record which endpoints honor session signing and whether an ER trigger order auto-executes when price crosses (place a tight TP and watch). Ask the kickoff AMA (15:00 UTC) about auto-execution + rate limits in parallel.
3. **ER trigger spike (2h):** On devnet: deploy a minimal Anchor program (anchor-counter skeleton), delegate an order PDA pinned to validator `MUS3...` (US), send one ER tx reading `ENYweb...` (READ-ONLY) + writing the PDA, then `ScheduleTask` at 100ms and watch ticks via getSignaturesForAddress. Working crank test scripts already exist at `D:\tmp\crank-test\` (run from `C:\Users\musha\AppData\Local\Temp\crank-test`). Then time commit→L1 with `GetCommitmentSignature` to get the real settlement number.
4. **Engine core (rest of night):** TS executor service: `subscribeOwner` WS + ER accountSubscribe on order PDAs; trailing/OCO state machine with client-side validation (6057 direction rules, $11 floor, 97%-close, both-fields edit, orderId-255 hazard); session-signed POST → sign → submit to `flash.magicblock.xyz`. Vendor the typed client from `packages/flash-v2` — don't rewrite. (Repo already cloned at `D:\Tools\flash-examples-v2-research`; MagicBlock source at `D:\Tools\mb-research`; local `magicblock` Claude skill at `C:\Users\musha\.claude\skills\magicblock`.)
5. **Trigger program for real (Sat AM):** Port the spike into the actual order program: Order PDA schema (trailing bps, HWM, OCO pair id, expiry), `tick` instruction gated on `crank_signer_pda(authority)` reading the Lazer feed via `pyth_solana_receiver_sdk` (`PriceUpdateV2::try_deserialize_unchecked`, watch the exponent-sign gotcha), FIRED-state commit. Then 1h timeboxed TEE privacy test (does getAccountInfo leak to non-members on devnet-tee?) — ship hidden stops only if it passes.

Demo checklist per past winners: live deployed URL, public GitHub, 60–90s video, and name the primitives on stage: delegation lifecycle, crank (show the live 10-ticks/sec feed), pricing oracle, session keys, Flash V2 ER.
