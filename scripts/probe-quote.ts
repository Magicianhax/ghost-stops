// Investigate the entry-vs-oracle gap: quote-only opens (no owner → no tx)
// across leverage/slippage/side/size and compare newEntryPrice to live mark.
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";

const flash = new FlashV2Client();
const mark = (await flash.price("SOL")).priceUi;
console.log("mark:", mark);

const cases = [
  { inputAmountUi: "11", leverage: 5, tradeType: "LONG" as const },
  { inputAmountUi: "11", leverage: 2, tradeType: "LONG" as const },
  { inputAmountUi: "11", leverage: 1.1, tradeType: "LONG" as const },
  { inputAmountUi: "11", leverage: 5, tradeType: "SHORT" as const },
  { inputAmountUi: "100", leverage: 5, tradeType: "LONG" as const },
  { inputAmountUi: "11", leverage: 5, tradeType: "LONG" as const, slippagePercentage: "0.1" },
];

for (const c of cases) {
  try {
    const q = await flash.openPosition({
      inputTokenSymbol: "USDC",
      outputTokenSymbol: "SOL",
      orderType: "MARKET",
      ...c,
    });
    const gap = ((Number(q.newEntryPrice) - mark) / mark) * 100;
    console.log(
      `lev=${c.leverage} ${c.tradeType} amt=${c.inputAmountUi} slip=${c.slippagePercentage ?? "0.5"}` +
        ` → entry=${q.newEntryPrice} gap=${gap.toFixed(3)}% fee=${q.entryFee} liq=${q.newLiquidationPrice}`
    );
  } catch (e) {
    console.log(`lev=${c.leverage} ${c.tradeType} → ERROR: ${(e as Error).message}`);
  }
}
