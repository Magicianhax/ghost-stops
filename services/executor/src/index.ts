// Ghost Stops executor — the bridge between trigger decisions (our ER) and
// execution (Flash's ER), plus the control API the web app talks to.
// Crash-safe: order state lives on-chain; a restart re-reconciles. Idempotent:
// every FIRED order is handled once via the on-disk inflight set + the
// on-chain EXECUTED/FAILED transition.
import { PublicKey } from "@solana/web3.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { FlashExecutor } from "./flash-exec.ts";
import { OrderClient, STATE, type OnChainOrder } from "./orders.ts";
import { SessionStore } from "./sessions.ts";

const cfg = loadConfig();
const orders = new OrderClient(cfg.erRpc, cfg.baseRpc, cfg.executorKeypair);
const sessions = new SessionStore(cfg.sessionsFile);
const flash = new FlashExecutor();

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
  const session = sessions.get(order.owner);
  if (!session) {
    log(`FIRED ${order.pda} but no valid session for owner ${order.owner} — will retry on reconcile`);
    return;
  }
  handled.set(order.pda, "inflight");
  persist();
  const n = (attempts.get(order.pda) ?? 0) + 1;
  attempts.set(order.pda, n);
  log(`FIRED ${order.pda} (${order.marketSymbol} ${order.isLong ? "LONG" : "SHORT"} ` +
      `kind=${order.kind} fired_price=${order.firedPrice}) via ${source}, attempt ${n}`);

  const result = await flash.executeFired(order, session);
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

// ── reconcile: catches missed events and retries ─────────────────────────────
async function reconcile() {
  try {
    const all = await orders.fetchAll();
    for (const o of all) {
      if (o.state === STATE.fired) await handleFired(o, "reconcile");
    }
  } catch (e) {
    log(`reconcile error: ${(e as Error).message}`);
  }
}

// ── control API (the web app's only backend) ─────────────────────────────────
const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": cfg.corsOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

async function readFeedPrice(feed: PublicKey): Promise<bigint> {
  const acc = await orders.conn.getAccountInfo(feed);
  if (!acc) throw new Error("feed account not found on ER");
  return (acc.data as Buffer).readBigInt64LE(73);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === "OPTIONS") return json(res, 204, {});
      const url = new URL(req.url ?? "/", "http://local");

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          program: cfg.programId.toBase58(),
          executor: cfg.executorKeypair.publicKey.toBase58(),
          owners: sessions.owners().length,
          markets: Object.keys(cfg.feeds),
        });
      }

      if (req.method === "POST" && url.pathname === "/session") {
        const b = JSON.parse(await readBody(req));
        if (!b.owner || !Array.isArray(b.secretKey) || !b.sessionToken || !b.validUntil) {
          return json(res, 400, { error: "owner, secretKey[], sessionToken, validUntil required" });
        }
        sessions.set(b.owner, b.secretKey, b.sessionToken, b.validUntil);
        log(`session registered for ${b.owner} (valid until ${new Date(b.validUntil * 1000).toISOString()})`);
        return json(res, 200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/orders") {
        const b = JSON.parse(await readBody(req));
        const market = String(b.market ?? "SOL").toUpperCase();
        const feed = cfg.feeds[market];
        if (!feed) return json(res, 400, { error: `no verified oracle feed for ${market} (have: ${Object.keys(cfg.feeds)})` });
        if (!b.owner) return json(res, 400, { error: "owner required" });
        if (!sessions.get(b.owner)) return json(res, 400, { error: "no valid session for owner — enable one-click trading first" });
        const kind = b.kind === "fixed" ? 1 : 0;
        const trailingBps = Math.max(0, Math.min(5000, Number(b.trailingBps ?? 0)));
        if (kind === 0 && (trailingBps < 10 || trailingBps > 5000)) {
          return json(res, 400, { error: "trailingBps must be 10..5000" });
        }
        const live = await readFeedPrice(feed);
        const triggerPrice = b.triggerPrice ? BigInt(Math.round(Number(b.triggerPrice) * 1e8)) : 0n;
        if (kind === 1 && triggerPrice <= 0n) return json(res, 400, { error: "triggerPrice required for fixed orders" });
        const result = await orders.createDelegateSchedule({
          owner: b.owner,
          market,
          feed,
          kind,
          trailingBps,
          initialPrice: live,
          triggerPrice,
          triggerAbove: Boolean(b.triggerAbove),
          sizePctBps: Math.max(100, Math.min(10_000, Number(b.sizePctBps ?? 10_000))),
          ocoLink: null,
          expiry: Number(b.expirySecs) > 0 ? Math.floor(Date.now() / 1000) + Number(b.expirySecs) : 0,
          isLong: b.isLong !== false,
        });
        log(`order created for ${b.owner}: ${result.pda} (${market} ${kind === 0 ? `trail ${trailingBps}bps` : `fixed @ ${b.triggerPrice}`})`);
        return json(res, 200, result);
      }

      if (req.method === "POST" && url.pathname.startsWith("/orders/") && url.pathname.endsWith("/cancel")) {
        const pda = url.pathname.split("/")[2]!;
        const acc = await orders.conn.getAccountInfo(new PublicKey(pda));
        if (!acc) return json(res, 404, { error: "order not found" });
        const order = orders.decode(new PublicKey(pda), acc.data as Buffer);
        await orders.cancelOrder(pda);
        await orders.cancelTick(order.orderId).catch(() => undefined);
        log(`order cancelled via API: ${pda}`);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: "not found" });
    } catch (e) {
      log(`API error ${req.method} ${req.url}: ${(e as Error).message}`);
      return json(res, 500, { error: (e as Error).message });
    }
  })();
});

log(`Ghost Stops executor up — program ${cfg.programId.toBase58()}`);
log(`executor key ${cfg.executorKeypair.publicKey.toBase58()} (pays devnet rent; holds only scoped sessions)`);
subscribe();
await reconcile();
setInterval(() => void reconcile(), 30_000);
server.listen(cfg.controlPort, () => log(`control API on :${cfg.controlPort}`));
