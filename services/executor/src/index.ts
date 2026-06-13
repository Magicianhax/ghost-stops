// Ghost Stops executor — the bridge between trigger decisions (our ER) and
// execution (Flash's ER). Crash-safe: order state lives on-chain; a restart
// re-reconciles. Idempotent: every FIRED order is handled exactly once via
// the on-disk inflight set + the on-chain EXECUTED/FAILED transition.
import { PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { FlashExecutor } from "./flash-exec.ts";
import { OrderClient, STATE, type OnChainOrder } from "./orders.ts";

const cfg = loadConfig();
const orders = new OrderClient(cfg.erRpc, cfg.executorKeypair);
const flash = new FlashExecutor(cfg.owner, cfg.sessionSigner, cfg.sessionToken);

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ── idempotence: pda → "inflight" | "done" ───────────────────────────────────
const handled = new Map<string, string>(
  existsSync(cfg.stateFile) ? Object.entries(JSON.parse(readFileSync(cfg.stateFile, "utf8"))) : []
);
const persist = () => writeFileSync(cfg.stateFile, JSON.stringify(Object.fromEntries(handled)));

const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();

async function handleFired(order: OnChainOrder, source: string) {
  if (handled.get(order.pda) === "inflight" || handled.get(order.pda) === "done") return;
  handled.set(order.pda, "inflight");
  persist();
  const n = (attempts.get(order.pda) ?? 0) + 1;
  attempts.set(order.pda, n);
  log(`FIRED ${order.pda} (${order.marketSymbol} ${order.isLong ? "LONG" : "SHORT"} ` +
      `kind=${order.kind} fired_price=${order.firedPrice}) via ${source}, attempt ${n}`);

  const result = await flash.executeFired(order);
  if (result.ok) {
    log(`EXECUTED ${order.pda}: ${result.detail} | trigger→fill ${result.latencyMs}ms`);
    await orders.markExecuted(order.pda, true).catch((e) => log(`mark_executed(true) failed: ${e.message}`));
    handled.set(order.pda, "done");
    persist();
    await cancelOcoSibling(order);
  } else if (n >= MAX_ATTEMPTS) {
    log(`FAILED ${order.pda} after ${n} attempts: ${result.detail} — marking failed, NEEDS ATTENTION`);
    await orders.markExecuted(order.pda, false).catch((e) => log(`mark_executed(false) failed: ${e.message}`));
    handled.set(order.pda, "done");
    persist();
  } else {
    log(`attempt ${n} failed (${result.detail}) — will retry on next reconcile`);
    handled.delete(order.pda);
    persist();
  }
}

async function cancelOcoSibling(order: OnChainOrder) {
  if (!order.ocoLink) return;
  try {
    const acc = await orders.conn.getAccountInfo(new PublicKey(order.ocoLink));
    if (!acc) return;
    const sibling = orders.decode(new PublicKey(order.ocoLink), acc.data as Buffer);
    if (sibling.state === STATE.active) {
      await orders.cancelOrder(sibling.pda);
      await orders.cancelTick(sibling.orderId).catch(() => undefined);
      log(`OCO sibling cancelled: ${sibling.pda}`);
    }
  } catch (e) {
    log(`OCO sibling cancel failed: ${(e as Error).message}`);
  }
}

// ── live watch: ER websocket pushes every crank-tick account change ──────────
function subscribe() {
  const subId = orders.conn.onProgramAccountChange(
    cfg.programId,
    (info, ctx) => {
      try {
        const order = orders.decode(info.accountId, info.accountInfo.data as Buffer);
        if (order.state === STATE.fired) void handleFired(order, `ws slot ${ctx.slot}`);
      } catch {
        // not an Order account — ignore
      }
    },
    { commitment: "confirmed" }
  );
  log(`subscribed to program accounts (sub ${subId}) on ${cfg.erRpc}`);
}

// ── reconcile: catches missed events, retries, settles vacancies ─────────────
async function reconcile() {
  try {
    const all = await orders.fetchAll();
    for (const o of all) {
      if (o.owner !== cfg.owner && o.executor !== cfg.executorKeypair.publicKey.toBase58()) continue;
      if (o.state === STATE.fired) await handleFired(o, "reconcile");
    }
  } catch (e) {
    log(`reconcile error: ${(e as Error).message}`);
  }
}

log(`Ghost Stops executor up — program ${cfg.programId.toBase58()}, owner ${cfg.owner}`);
log(`session ${cfg.sessionSigner.publicKey.toBase58()} (cannot withdraw funds, expires per token)`);
subscribe();
await reconcile();
setInterval(() => void reconcile(), 30_000);
