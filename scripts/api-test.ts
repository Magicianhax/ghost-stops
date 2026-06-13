// Full product-path test through the executor control API (real money, $11):
// open real position (session) → POST /orders trailing 10bps → watch the crank
// trail the live price on-chain until natural retrace fires it → executor fill.
import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, Program, Wallet } = anchorPkg;
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { loadWallet } from "./lib/wallet.ts";
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";
import { sendAndConfirm, signWithKeypair } from "../packages/flash-v2/src/sign.ts";

const WATCH_ONLY = process.argv[2]; // pass an order PDA to skip opening

const ER = new Connection("https://devnet.magicblock.app", "confirmed");
const API = "http://localhost:8787";

const kp = loadWallet();
const owner = kp.publicKey.toBase58();
const session = JSON.parse(readFileSync(".session.json", "utf8"));
const sessionSigner = Keypair.fromSecretKey(Uint8Array.from(session.secretKey));
const flash = new FlashV2Client();

let pdaStr: string;
if (WATCH_ONLY) {
  pdaStr = WATCH_ONLY;
  console.log(`watch-only mode: ${pdaStr}`);
} else {
  // ── 1. real position ───────────────────────────────────────────────────────
  console.log("opening $11 × 1.1x SOL LONG (session-signed)…");
  const built = await flash.openPosition({
    inputTokenSymbol: "USDC", outputTokenSymbol: "SOL", inputAmountUi: "11",
    leverage: 1.1, tradeType: "LONG", orderType: "MARKET", owner,
    slippagePercentage: "0.5",
    signer: sessionSigner.publicKey.toBase58(), sessionToken: session.sessionToken,
  });
  const open = await sendAndConfirm(flash.network.erRpc, signWithKeypair(built.transactionBase64!, sessionSigner), { skipPreflight: true });
  console.log(`✓ position open (${open.confirmMs}ms) → ${open.signature}`);

  // ── 2. attach trailing stop via the executor API (the product path) ────────
  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, market: "SOL", kind: "trailing", trailingBps: 10, sizePctBps: 10000, isLong: true }),
  });
  const order = await res.json();
  if (!res.ok) throw new Error(`API: ${order.error}`);
  console.log(`✓ trailing stop attached via API: ${order.pda}`);
  pdaStr = order.pda;
}

// ── 3. watch the on-chain trail until it fires ───────────────────────────────
const pda = new PublicKey(pdaStr);
const idl = JSON.parse(readFileSync("target/idl/ghost_stops.json", "utf8"));
const program = new Program(idl, new AnchorProvider(ER, new Wallet(kp), { commitment: "confirmed" }));

const t0 = Date.now();
let lastLine = "";
for (let i = 0; i < 600; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const acc = await ER.getAccountInfo(pda);
  if (!acc) continue;
  const o = program.coder.accounts.decode("order", acc.data);
  const feed = await ER.getAccountInfo(new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"));
  const live = feed!.data.readBigInt64LE(73);
  const hwm = BigInt(o.highWaterMark.toString());
  const stop = hwm - (hwm / 10000n) * 10n;
  const line = `t+${Math.floor((Date.now() - t0) / 1000)}s live=$${(Number(live) / 1e8).toFixed(3)} HWM=$${(Number(hwm) / 1e8).toFixed(3)} stop=$${(Number(stop) / 1e8).toFixed(3)} state=${o.state}`;
  if (line !== lastLine) { console.log(line); lastLine = line; }
  if (o.state === 2) {
    console.log(`★ TRAILING STOP EXECUTED — fired at $${(Number(BigInt(o.firedPrice.toString())) / 1e8).toFixed(3)} after ${Math.floor((Date.now() - t0) / 1000)}s of on-chain trailing`);
    break;
  }
  if (o.state === 4) { console.log("order FAILED — check executor log"); break; }
}
const snap = await flash.owner(owner);
console.log(`Flash positions remaining: ${Object.values(snap.positionMetrics).length}`);
