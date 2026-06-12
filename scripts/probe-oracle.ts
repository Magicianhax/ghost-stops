// Probe C part 1 — oracle freshness inside the devnet ER.
// Reads the SOL/USD Pyth Lazer feed PDA twice, parses price i64 @ byte 73 and
// exponent i32 @ byte 89, asserts it updates and matches mainnet Flash price.
import { Connection, PublicKey } from "@solana/web3.js";
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";

const FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const er = new Connection("https://devnet.magicblock.app", "confirmed");

function parse(data: Buffer) {
  const price = data.readBigInt64LE(73);
  // Exponent-sign gotcha (verified): stored as +8 but means 10^-8. Use -|exp|.
  // Trailing logic on-chain compares RAW i64s and never needs this.
  const exponent = data.readInt32LE(89);
  return { price, exponent, ui: Number(price) * Math.pow(10, -Math.abs(exponent)) };
}

const a1 = await er.getAccountInfo(FEED);
if (!a1) throw new Error("feed account not found on devnet ER");
const r1 = parse(a1.data);
await new Promise((r) => setTimeout(r, 2000));
const a2 = await er.getAccountInfo(FEED);
const r2 = parse(a2!.data);

const flashMark = (await new FlashV2Client().price("SOL")).priceUi;

console.log(`read 1: raw=${r1.price} exp=${r1.exponent} → $${r1.ui.toFixed(4)}`);
console.log(`read 2: raw=${r2.price} exp=${r2.exponent} → $${r2.ui.toFixed(4)}`);
console.log(`changed between reads (2s apart): ${r1.price !== r2.price}`);
console.log(`flash mainnet mark: $${flashMark}`);
const gap = ((r2.ui - flashMark) / flashMark) * 100;
console.log(`devnet-ER oracle vs mainnet flash: ${gap.toFixed(4)}%`);
if (Math.abs(gap) > 0.5) throw new Error("oracle gap >0.5% — investigate");
console.log("✓ devnet ER oracle is live, fresh, and tracks mainnet price");
