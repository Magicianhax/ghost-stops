// Probe B — session-key capability matrix (REAL MONEY, small).
// 1. Mint a SessionTokenV2 (client-side, gum-sdk) — base chain, wallet signs once.
// 2. With ONLY the session key: open → place SL → edit SL → cancel SL → close.
// 3. Auto-execution: place a TP 0.05% above mark; does Flash's keeper fill it?
// Records a pass/fail matrix that decides the executor architecture.
import anchor from "@coral-xyz/anchor";
const { BN } = anchor;
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { loadWallet } from "./lib/wallet.ts";
import { FlashV2Client } from "../packages/flash-v2/src/index.ts";
import { signWithKeypair, sendAndConfirm } from "../packages/flash-v2/src/sign.ts";

const KEYSP = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const MAGIC_TRADE = new PublicKey("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");

const kp = loadWallet();
const owner = kp.publicKey.toBase58();
const flash = new FlashV2Client();
const baseConn = new Connection(flash.network.baseRpc, "confirmed");
const matrix: Record<string, string> = {};

// ── 1. mint or load session ──────────────────────────────────────────────────
let sessionSigner: Keypair;
let sessionToken: PublicKey;
if (existsSync(".session.json")) {
  const s = JSON.parse(readFileSync(".session.json", "utf8"));
  if (s.validUntil > Date.now() / 1000 + 600) {
    sessionSigner = Keypair.fromSecretKey(Uint8Array.from(s.secretKey));
    sessionToken = new PublicKey(s.sessionToken);
    console.log("reusing session from .session.json:", sessionToken.toBase58());
  }
}
// @ts-expect-error assigned conditionally
if (!sessionSigner) {
  sessionSigner = Keypair.generate();
  const validUntil = Math.floor(Date.now() / 1000) + 24 * 3600;
  [sessionToken] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("session_token_v2"),
      MAGIC_TRADE.toBytes(),
      sessionSigner.publicKey.toBytes(),
      kp.publicKey.toBytes(),
    ],
    KEYSP
  );
  const wallet = {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(kp);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      for (const t of txs) t.partialSign(kp);
      return txs;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manager = new SessionTokenManager(wallet as any, baseConn);
  const tx = await manager.program.methods
    .createSessionV2(true, new BN(validUntil), new BN(0.01 * 1e9))
    .accountsPartial({
      sessionToken,
      sessionSigner: sessionSigner.publicKey,
      feePayer: kp.publicKey,
      authority: kp.publicKey,
      targetProgram: MAGIC_TRADE,
    })
    .transaction();
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await baseConn.getLatestBlockhash()).blockhash;
  tx.partialSign(sessionSigner);
  tx.partialSign(kp);
  const sig = await baseConn.sendRawTransaction(tx.serialize());
  await baseConn.confirmTransaction(sig, "confirmed");
  console.log("session created:", sessionToken.toBase58(), "→", sig);
  writeFileSync(
    ".session.json",
    JSON.stringify({
      secretKey: Array.from(sessionSigner.secretKey),
      sessionToken: sessionToken.toBase58(),
      sessionSigner: sessionSigner.publicKey.toBase58(),
      validUntil,
    })
  );
}
const session = { signer: sessionSigner.publicKey.toBase58(), sessionToken: sessionToken.toBase58() };

async function sessionStep(label: string, build: () => Promise<{ transactionBase64?: string | null }>) {
  try {
    const built = await build();
    if (!built.transactionBase64) throw new Error("no tx returned");
    const tx = signWithKeypair(built.transactionBase64, sessionSigner);
    const { signature, confirmMs } = await sendAndConfirm(flash.network.erRpc, tx, { skipPreflight: true });
    matrix[label] = `PASS (${confirmMs}ms)`;
    console.log(`✓ ${label} — session-signed, ${confirmMs}ms → ${signature}`);
    return true;
  } catch (e) {
    matrix[label] = `FAIL: ${(e as Error).message.slice(0, 140)}`;
    console.log(`✗ ${label} — ${(e as Error).message.slice(0, 200)}`);
    return false;
  }
}

const mark = () => flash.price("SOL").then((p) => p.priceUi);
const m0 = await mark();
console.log(`SOL mark: $${m0}`);

// ── 2. capability matrix, all session-signed ────────────────────────────────
const opened = await sessionStep("open-position", () =>
  flash.openPosition({
    inputTokenSymbol: "USDC",
    outputTokenSymbol: "SOL",
    inputAmountUi: "11",
    leverage: 1.1,
    tradeType: "LONG",
    orderType: "MARKET",
    owner,
    slippagePercentage: "0.5",
    ...session,
  })
);
if (!opened) {
  console.log("session open failed — opening owner-signed so trigger tests can proceed");
  const built = await flash.openPosition({
    inputTokenSymbol: "USDC", outputTokenSymbol: "SOL", inputAmountUi: "11",
    leverage: 1.1, tradeType: "LONG", orderType: "MARKET", owner, slippagePercentage: "0.5",
  });
  await sendAndConfirm(flash.network.erRpc, signWithKeypair(built.transactionBase64!, kp), { skipPreflight: true });
}
await new Promise((r) => setTimeout(r, 1500));
const snap1 = await flash.owner(owner);
const pos = Object.values(snap1.positionMetrics)[0];
if (!pos) throw new Error("no position after open");
const posSize = pos.sizeAmountUi;
console.log(`position: ${pos.sideUi} size=${posSize} SOL ($${pos.sizeUsdUi})`);

await sessionStep("place-trigger-order (SL)", () =>
  flash.placeTriggerOrder({
    marketSymbol: "SOL", side: "LONG",
    triggerPriceUi: (m0 * 0.5).toFixed(2),
    sizeAmountUi: posSize, isStopLoss: true, owner, ...session,
  })
);
await sessionStep("edit-trigger-order", () =>
  flash.editTriggerOrder({
    marketSymbol: "SOL", side: "LONG", orderId: 0, isStopLoss: true,
    triggerPriceUi: (m0 * 0.45).toFixed(2),
    sizeAmountUi: posSize, owner, ...session,
  })
);
await sessionStep("cancel-trigger-order", () =>
  flash.cancelTriggerOrder({
    marketSymbol: "SOL", side: "LONG", orderId: 0, isStopLoss: true, owner, ...session,
  })
);

// ── 3. auto-execution: does Flash's keeper fill a crossed TP? ────────────────
const m1 = await mark();
const tpPrice = (m1 * 1.0005).toFixed(2);
const placedTp = await sessionStep(`place-tp @ ${tpPrice} (0.05% above)`, () =>
  flash.placeTriggerOrder({
    marketSymbol: "SOL", side: "LONG",
    triggerPriceUi: tpPrice, sizeAmountUi: posSize, isStopLoss: false, owner, ...session,
  })
);
if (placedTp) {
  console.log("polling 120s for keeper auto-execution…");
  const t0 = Date.now();
  let filled = false;
  while (Date.now() - t0 < 120_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await flash.owner(owner).catch(() => null);
    if (!s) continue;
    const p = Object.values(s.positionMetrics)[0];
    const m = await mark().catch(() => 0);
    if (!p) {
      filled = true;
      matrix["keeper-auto-execution"] = `FILLED after ${((Date.now() - t0) / 1000).toFixed(0)}s`;
      console.log(`✓ keeper filled the TP after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      break;
    }
    process.stdout.write(`  mark=$${m.toFixed(3)} vs TP=$${tpPrice} pos still open (${((Date.now() - t0) / 1000).toFixed(0)}s)\r`);
  }
  if (!filled) {
    matrix["keeper-auto-execution"] = "NOT filled in 120s (note: price may not have crossed)";
    console.log("\n✗ not auto-filled within 120s — cancel TP and close manually");
    await sessionStep("cancel-tp-cleanup", () =>
      flash.cancelTriggerOrder({ marketSymbol: "SOL", side: "LONG", orderId: 0, isStopLoss: false, owner, ...session })
    );
  }
}

// ── 4. close (session-signed) if still open ──────────────────────────────────
const sFinal = await flash.owner(owner);
if (Object.values(sFinal.positionMetrics).length > 0) {
  await sessionStep("close-position", () =>
    flash.closePosition({
      marketSymbol: "SOL", side: "LONG", inputUsdUi: "0",
      withdrawTokenSymbol: "USDC", owner, ...session,
    })
  );
}

console.log("\n══ SESSION-KEY CAPABILITY MATRIX ══");
for (const [k, v] of Object.entries(matrix)) console.log(`${v.startsWith("PASS") || v.startsWith("FILLED") ? "✓" : "✗"} ${k}: ${v}`);
