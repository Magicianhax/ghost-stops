// Probe A (REAL MONEY) — Flash V2 lifecycle on mainnet with the funded wallet.
// Conservative: 15 USDC deposit, one $11 × 1.1x LONG, verify ACTUAL entry vs
// oracle (the quote shows a constant ±10% band we believe is a display bound),
// then close. Idempotent: skips setup steps whose state already exists.
import { loadWallet } from "./lib/wallet.ts";
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";
import { signWithKeypair, sendAndConfirm } from "../packages/flash-v2/src/sign.ts";
import { FlashV2Error } from "../packages/flash-v2/src/errors.ts";

const kp = loadWallet();
const owner = kp.publicKey.toBase58();
const flash = new FlashV2Client();
console.log(`owner ${owner} · api ${flash.network.apiBase}`);

async function submit(label: string, chain: "base" | "er", txB64: string | null | undefined) {
  if (!txB64) throw new Error(`${label}: no transactionBase64 returned`);
  const rpc = chain === "er" ? flash.network.erRpc : flash.network.baseRpc;
  const tx = signWithKeypair(txB64, kp);
  const { signature, confirmMs } = await sendAndConfirm(rpc, tx, {
    skipPreflight: chain === "er",
  });
  console.log(`⛓ ${label} confirmed on ${chain.toUpperCase()} in ${confirmMs}ms → ${signature}`);
  return signature;
}

const mark = (await flash.price("SOL")).priceUi;
console.log(`SOL mark: $${mark}`);

// ── setup (idempotent) ────────────────────────────────────────────────────────
let snap = await flash.owner(owner).catch(() => null);
if (!snap?.basketPubkey) {
  console.log("fresh owner — running one-time setup (base chain)");
  await submit("init-basket", "base", (await flash.initBasket({ owner })).transactionBase64);
  await submit("init-deposit-ledger", "base", (await flash.initDepositLedger({ owner })).transactionBase64);
  await submit("delegate-basket", "base", (await flash.delegateBasket({ payer: owner, owner })).transactionBase64);
} else {
  console.log(`basket exists: ${snap.basketPubkey} — skipping setup`);
}

// ── deposit 15 USDC (skip if a prior run already deposited) ──────────────────
const skipDeposit = process.argv.includes("--skip-deposit");
if (!skipDeposit) {
  const usdcMint = (await flash.tokens()).find((t) => t.symbol === "USDC")!.mintKey;
  await submit(
    "deposit-direct 15 USDC",
    "base",
    (await flash.depositDirect({ owner, tokenMint: usdcMint, amount: "15" })).transactionBase64
  );
}

// ── open $11 × 1.1x LONG (ER) ────────────────────────────────────────────────
const open = await flash.openPosition({
  inputTokenSymbol: "USDC",
  outputTokenSymbol: "SOL",
  inputAmountUi: "11",
  leverage: 1.1,
  tradeType: "LONG",
  orderType: "MARKET",
  owner,
  slippagePercentage: "0.5",
});
console.log(`quote: entry=${open.newEntryPrice} fee=${open.entryFee} liq=${open.newLiquidationPrice}`);
const t0 = Date.now();
await submit("open-position", "er", open.transactionBase64);
console.log(`open round-trip: ${Date.now() - t0}ms`);

// ── verify ACTUAL entry vs oracle ────────────────────────────────────────────
await new Promise((r) => setTimeout(r, 1500));
snap = await flash.owner(owner);
const positions = Object.values(snap.positionMetrics);
if (positions.length === 0) throw new Error("no position visible after open!");
for (const p of positions) {
  const entry = Number(p.entryPriceUi);
  const gapPct = ((entry - mark) / mark) * 100;
  console.log(
    `POSITION ${p.marketSymbol} ${p.sideUi} size=$${p.sizeUsdUi} collateral=$${p.collateralUsdUi}` +
      ` ACTUAL entry=$${entry} vs mark=$${mark} → gap ${gapPct.toFixed(3)}% · liq=$${p.liquidationPriceUi} · PnL ${p.pnlWithFeeUsdUi}`
  );
  if (Math.abs(gapPct) > 2) console.log("⚠ REAL gap >2% — quote bound is NOT just display. Closing now.");
  else console.log("✓ fill at oracle — the quote's ±10% is just a worst-case band");
}

// ── close (full) ─────────────────────────────────────────────────────────────
const close = await flash.closePosition({
  marketSymbol: "SOL",
  side: "LONG",
  inputUsdUi: "0",
  withdrawTokenSymbol: "USDC",
  owner,
});
console.log(`close quote: receive ≈ ${close.receiveTokenAmountUi} ${close.receiveTokenSymbol} · settled PnL ${close.settledPnl}`);
const t1 = Date.now();
await submit("close-position", "er", close.transactionBase64);
console.log(`close round-trip: ${Date.now() - t1}ms`);

await new Promise((r) => setTimeout(r, 1500));
snap = await flash.owner(owner);
console.log(`positions after close: ${Object.values(snap.positionMetrics).length}`);
console.log("PROBE A COMPLETE");
