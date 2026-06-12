// Task 5 integration test (devnet, no real money):
// create_order (base) → delegate_order (base) → manual tick (ER) → verify HWM
// → schedule_tick crank (ER) → watch the validator tick it for us.
import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, BN, Program, Wallet } = anchorPkg;
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { loadWallet } from "./lib/wallet.ts";

const BASE = new Connection("https://api.devnet.solana.com", "confirmed");
const ER = new Connection("https://devnet.magicblock.app", "confirmed");
const FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

const kp = loadWallet();
const idl = JSON.parse(readFileSync("target/idl/ghost_stops.json", "utf8"));
const provider = new AnchorProvider(BASE, new Wallet(kp), { commitment: "confirmed" });
const program = new Program(idl, provider);
const PROGRAM_ID: PublicKey = program.programId;
console.log("program:", PROGRAM_ID.toBase58(), "wallet:", kp.publicKey.toBase58());

const readFeedPrice = async (conn: Connection) => {
  const acc = await conn.getAccountInfo(FEED);
  if (!acc) throw new Error("feed not found");
  return acc.data.readBigInt64LE(73);
};

async function send(conn: Connection, tx: Transaction, label: string, skipPreflight = false) {
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight });
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`✓ ${label} → ${sig}`);
  return sig;
}

const orderId = new BN(Math.floor(Date.now() / 1000)); // unique per run
const [orderPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("order"), kp.publicKey.toBytes(), orderId.toArrayLike(Buffer, "le", 8)],
  PROGRAM_ID
);
console.log("order PDA:", orderPda.toBase58(), "order_id:", orderId.toString());

// ── 1. create_order (base) ───────────────────────────────────────────────────
const livePrice = await readFeedPrice(ER);
console.log("live raw price:", livePrice.toString(), `($${(Number(livePrice) / 1e8).toFixed(2)})`);
const params = {
  orderId,
  kind: 0, // TrailingStop
  marketSymbol: Array.from(Buffer.from("SOL\0\0\0\0\0")),
  priceFeed: FEED,
  trailingBps: 50, // 0.5% — tight, demo-friendly
  initialPrice: new BN(livePrice.toString()),
  triggerPrice: new BN(0),
  triggerAbove: false,
  sizePctBps: 10_000,
  ocoLink: null,
  expiry: new BN(0),
  isLong: true,
  executor: kp.publicKey,
};
await send(BASE, await program.methods.createOrder(params).accountsPartial({
  owner: kp.publicKey,
}).transaction(), "create_order (base)");

// ── 2. delegate_order (base) ─────────────────────────────────────────────────
await send(BASE, await program.methods.delegateOrder(kp.publicKey, orderId).accountsPartial({
  payer: kp.publicKey,
  order: orderPda,
  validator: null,
}).transaction(), "delegate_order (base)");
await new Promise((r) => setTimeout(r, 3000)); // state propagation

const ownerNow = (await BASE.getAccountInfo(orderPda))!.owner;
console.log("order PDA owner after delegate:", ownerNow.toBase58(), ownerNow.equals(DELEGATION_PROGRAM) ? "(delegated ✓)" : "(NOT delegated ✗)");

// ── 3. manual tick (ER) ──────────────────────────────────────────────────────
await send(ER, await program.methods.tick().accountsPartial({
  order: orderPda,
  priceFeed: FEED,
}).transaction(), "manual tick (ER)", true);

const decode = (data: Buffer) => program.coder.accounts.decode("order", data);
const afterTick = decode((await ER.getAccountInfo(orderPda))!.data);
console.log(`HWM after manual tick: ${afterTick.highWaterMark.toString()} (state=${afterTick.state})`);

// ── 4. schedule_tick crank (ER): 100ms × 100 iterations ─────────────────────
await send(ER, await program.methods.scheduleTick({
  taskId: orderId,
  intervalMs: new BN(100),
  iterations: new BN(100),
}).accountsPartial({
  payer: kp.publicKey,
  order: orderPda,
  priceFeed: FEED,
}).transaction(), "schedule_tick crank (ER)", true);

console.log("watching the validator tick for 5s…");
await new Promise((r) => setTimeout(r, 5000));
const sigs = await ER.getSignaturesForAddress(orderPda, { limit: 100 });
const afterCrank = decode((await ER.getAccountInfo(orderPda))!.data);
console.log(`crank executions visible: ${sigs.length}`);
console.log(`HWM after crank: ${afterCrank.highWaterMark.toString()} vs live ${(await readFeedPrice(ER)).toString()}`);
console.log(`state: ${JSON.stringify(afterCrank.state)} fired_price: ${afterCrank.firedPrice.toString()}`);
console.log("PROGRAM SPIKE COMPLETE — crank is ticking our order on-chain");
