// END-TO-END LIVE TEST (real money, $11):
// 1. open $11×1.1 SOL LONG on Flash mainnet (session-signed)
// 2. create+delegate a FixedTrigger order on devnet ER set to fire on the
//    FIRST crank tick (trigger_above @ 0.05% below current price)
// 3. schedule the 100ms crank
// The running executor must then close the real position. Watch its log.
import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, BN, Program, Wallet } = anchorPkg;
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { loadWallet } from "./lib/wallet.ts";
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";
import { sendAndConfirm, signWithKeypair } from "../packages/flash-v2/src/sign.ts";

const BASE = new Connection("https://api.devnet.solana.com", "confirmed");
const ER = new Connection("https://devnet.magicblock.app", "confirmed");
const FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");

const kp = loadWallet();
const owner = kp.publicKey.toBase58();
const session = JSON.parse(readFileSync(".session.json", "utf8"));
const sessionSigner = Keypair.fromSecretKey(Uint8Array.from(session.secretKey));
const flash = new FlashV2Client();

const idl = JSON.parse(readFileSync("target/idl/ghost_stops.json", "utf8"));
const program = new Program(idl, new AnchorProvider(BASE, new Wallet(kp), { commitment: "confirmed" }));

async function send(conn: Connection, tx: Transaction, label: string, skipPreflight = false) {
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight });
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`✓ ${label} → ${sig}`);
}

// ── 1. real position on Flash mainnet ────────────────────────────────────────
console.log("opening $11 × 1.1x SOL LONG on Flash mainnet (session-signed)…");
const built = await flash.openPosition({
  inputTokenSymbol: "USDC", outputTokenSymbol: "SOL", inputAmountUi: "11",
  leverage: 1.1, tradeType: "LONG", orderType: "MARKET", owner,
  slippagePercentage: "0.5",
  signer: sessionSigner.publicKey.toBase58(), sessionToken: session.sessionToken,
});
const { signature, confirmMs } = await sendAndConfirm(
  flash.network.erRpc, signWithKeypair(built.transactionBase64!, sessionSigner), { skipPreflight: true });
console.log(`✓ position open (${confirmMs}ms) → ${signature}`);

// ── 2. instant-fire trigger order on our devnet ER ───────────────────────────
const feedAcc = await ER.getAccountInfo(FEED);
const live = feedAcc!.data.readBigInt64LE(73);
const trigger = (live * 9995n) / 10000n; // 0.05% below → fires on first tick
console.log(`live raw=${live} → trigger_above @ ${trigger} (fires immediately)`);

const orderId = new BN(Math.floor(Date.now() / 1000));
const [orderPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("order"), kp.publicKey.toBytes(), orderId.toArrayLike(Buffer, "le", 8)],
  program.programId
);
console.log("order PDA:", orderPda.toBase58());

await send(BASE, await program.methods.createOrder({
  orderId,
  kind: 1, // FixedTrigger
  marketSymbol: Array.from(Buffer.from("SOL\0\0\0\0\0")),
  priceFeed: FEED,
  trailingBps: 0,
  initialPrice: new BN(live.toString()),
  triggerPrice: new BN(trigger.toString()),
  triggerAbove: true,
  sizePctBps: 10_000,
  ocoLink: null,
  expiry: new BN(0),
  isLong: true,
  executor: kp.publicKey,
}).accountsPartial({ owner: kp.publicKey }).transaction(), "create_order (devnet base)");

await send(BASE, await program.methods.delegateOrder(kp.publicKey, orderId).accountsPartial({
  payer: kp.publicKey, order: orderPda, validator: null,
}).transaction(), "delegate_order (devnet base)");
await new Promise((r) => setTimeout(r, 3000));

const T_SCHEDULE = Date.now();
await send(ER, await program.methods.scheduleTick({
  taskId: orderId, intervalMs: new BN(100), iterations: new BN(300),
}).accountsPartial({
  payer: kp.publicKey, order: orderPda, priceFeed: FEED,
}).transaction(), "schedule_tick 100ms (devnet ER)", true);

// ── 3. watch for FIRED + position closure ────────────────────────────────────
console.log("waiting for crank fire + executor fill…");
let firedAt = 0;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const acc = await ER.getAccountInfo(orderPda);
  const order = program.coder.accounts.decode("order", acc!.data);
  if (order.state >= 1 && !firedAt) {
    firedAt = Date.now();
    console.log(`order FIRED on-chain after ${firedAt - T_SCHEDULE}ms (state=${order.state}, fired_price=${order.firedPrice})`);
  }
  if (order.state === 2) {
    console.log(`order EXECUTED — total schedule→executed: ${Date.now() - T_SCHEDULE}ms`);
    break;
  }
  if (order.state === 4) {
    console.log("order FAILED — check executor log");
    break;
  }
}
const snap = await flash.owner(owner);
console.log(`Flash positions remaining: ${Object.values(snap.positionMetrics).length} (expect 0)`);
