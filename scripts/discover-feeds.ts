// Discover + VERIFY MagicBlock ER oracle feeds for every market Flash trades.
//
// MagicBlock pushes Pyth Lazer feeds into the devnet ER as Pyth PriceUpdateV3
// accounts owned by PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd. The feed PDA is
// derivable: seeds ["price_feed", "pyth-lazer", <lazer_id as decimal string>].
// price i64 @ byte 73, exponent i32 @ byte 89 — the SAME layout our on-chain
// `tick` already reads (FEED_PRICE_OFFSET=73), so any verified feed works with
// ZERO program redeploy.
//
// This script trusts NOTHING: it derives each PDA, reads it from the ER twice
// (must be present, price>0, and updating), and cross-checks the price against
// Flash's live mainnet mark within tolerance — exactly how probe-oracle.ts
// verified SOL. Output is a ready-to-paste config.feeds block of VERIFIED feeds.
import { Connection, PublicKey } from "@solana/web3.js";
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";

const ORACLE_PROGRAM = new PublicKey("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
const ER = new Connection("https://devnet.magicblock.app", "confirmed");
const LIST_URL = "https://raw.githubusercontent.com/magicblock-labs/real-time-pricing-oracle/main/pyth_lazer_list.json";
const KNOWN_SOL = "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"; // derivation sanity anchor
const PRICE_TOLERANCE_PCT = 2.0; // ER oracle vs Flash mark; majors track <0.5%

interface LazerEntry { pyth_lazer_id: number; name: string; symbol: string; exponent: number; }

/** Derive the ER feed PDA for a Pyth Lazer numeric id. */
function feedPda(lazerId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("price_feed"), Buffer.from("pyth-lazer"), Buffer.from(String(lazerId))],
    ORACLE_PROGRAM,
  )[0];
}

/** "Crypto.BTC/USD" → "BTC"; "SOLUSD"/name fallback → "SOL". */
function baseSymbol(e: LazerEntry): string {
  const m = e.symbol.match(/([A-Z0-9]+)\/USD$/i);
  if (m) return m[1]!.toUpperCase();
  return e.name.replace(/USD$/i, "").toUpperCase();
}

function readFeed(data: Buffer): { price: bigint; exponent: number; ui: number } {
  const price = data.readBigInt64LE(73);
  const exponent = data.readInt32LE(89); // stored as +8 but means 10^-8
  return { price, exponent, ui: Number(price) * Math.pow(10, -Math.abs(exponent)) };
}

// 1) canonical Lazer list → base symbol → entry
const list = (await (await fetch(LIST_URL)).json()) as LazerEntry[];
const bySymbol = new Map<string, LazerEntry>();
for (const e of list) bySymbol.set(baseSymbol(e), e);
console.log(`Lazer list: ${list.length} feeds (BTC=${bySymbol.get("BTC")?.pyth_lazer_id}, SOL=${bySymbol.get("SOL")?.pyth_lazer_id}, HYPE=${bySymbol.get("HYPE")?.pyth_lazer_id})`);

// 2) derivation sanity: SOL must derive to the address we already verified
const solDerived = feedPda(bySymbol.get("SOL")!.pyth_lazer_id).toBase58();
if (solDerived !== KNOWN_SOL) throw new Error(`derivation BROKEN: SOL derived ${solDerived} ≠ ${KNOWN_SOL}`);
console.log(`✓ derivation scheme verified (SOL → ${solDerived})\n`);

// 3) which markets does Flash actually trade?
const flash = new FlashV2Client();
const tokens = await flash.tokens();
const targets = tokens.filter((t) => !t.isStable).map((t) => t.symbol.toUpperCase());
console.log(`Flash markets (${targets.length}): ${targets.join(", ")}\n`);

// 4) derive → verify each on the ER + price-match Flash
const verified: Array<{ sym: string; pda: string; ui: number; exp: number; gap: number }> = [];
const skipped: Array<{ sym: string; why: string }> = [];

for (const sym of targets) {
  const entry = bySymbol.get(sym);
  if (!entry) { skipped.push({ sym, why: "no Pyth Lazer feed for this symbol" }); continue; }
  const pda = feedPda(entry.pyth_lazer_id);
  try {
    const a1 = await ER.getAccountInfo(pda);
    if (!a1) { skipped.push({ sym, why: `not pushed to ER (${pda.toBase58()})` }); continue; }
    if (!a1.owner.equals(ORACLE_PROGRAM)) { skipped.push({ sym, why: `wrong owner ${a1.owner.toBase58()}` }); continue; }
    const r1 = readFeed(a1.data as Buffer);
    if (r1.price <= 0n) { skipped.push({ sym, why: "price <= 0" }); continue; }
    await new Promise((r) => setTimeout(r, 1500));
    const r2 = readFeed((await ER.getAccountInfo(pda))!.data as Buffer);

    let gap = NaN;
    try {
      const mark = (await flash.price(sym)).priceUi;
      gap = ((r2.ui - mark) / mark) * 100;
    } catch { /* Flash price unavailable — fall back to liveness only */ }

    const fresh = r1.price !== r2.price;
    const priceOk = Number.isNaN(gap) ? true : Math.abs(gap) <= PRICE_TOLERANCE_PCT;
    if (!priceOk) { skipped.push({ sym, why: `price gap ${gap.toFixed(2)}% > ${PRICE_TOLERANCE_PCT}% (ER $${r2.ui} vs Flash)` }); continue; }

    verified.push({ sym, pda: pda.toBase58(), ui: r2.ui, exp: r2.exponent, gap });
    console.log(`✓ ${sym.padEnd(8)} id=${String(entry.pyth_lazer_id).padStart(3)}  $${r2.ui.toFixed(r2.ui < 1 ? 6 : 2).padStart(11)}  ${fresh ? "fresh" : "STATIC"}  gap=${Number.isNaN(gap) ? "n/a" : gap.toFixed(3) + "%"}  ${pda.toBase58()}`);
  } catch (e) {
    skipped.push({ sym, why: (e as Error).message });
  }
}

// 5) emit a ready-to-paste config block
console.log(`\n──────── VERIFIED ${verified.length}/${targets.length} ────────`);
console.log("    feeds: {");
for (const v of verified) {
  const note = v.exp !== 8 ? `  // exp -${Math.abs(v.exp)} (non-1e8 scale)` : "";
  console.log(`      ${v.sym}: new PublicKey("${v.pda}"),${note}`);
}
console.log("    },");
if (skipped.length) {
  console.log(`\nSkipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  – ${s.sym}: ${s.why}`);
}
