// Ghost Stops executor — the bridge between trigger decisions (our ER) and
// execution (Flash's ER), plus the control API the web app talks to.
// Crash-safe: order state lives on-chain; a restart re-reconciles. Idempotent:
// every FIRED order is handled once via the on-disk inflight set + the
// on-chain EXECUTED/FAILED transition.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { FlashExecutor } from "./flash-exec.ts";
import { OrderClient, STATE, type OnChainOrder } from "./orders.ts";
import { SessionStore } from "./sessions.ts";

const cfg = loadConfig();
const orders = new OrderClient(cfg.erRpc, cfg.baseRpc, cfg.executorKeypair);
const sessions = new SessionStore(cfg.sessionsFile);
const flash = new FlashExecutor();

// Session authenticity constants (mainnet — where Flash + the Keysp program live).
const SESSION_KEYS_PROGRAM = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const MAGIC_TRADE = new PublicKey("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");
const mainnet = new Connection(process.env.FLASH_BASE_RPC ?? "https://api.mainnet-beta.solana.com", "confirmed");

// ── wallet sign-in: signed message → bearer token for state-changing routes ──
const AUTH_MAX_AGE_MS = 10 * 60 * 1000; // signed message freshness window
const TOKEN_TTL_MS = 24 * 3600 * 1000;
const MAX_SESSION_HOURS = 168; // gum SDK session ceiling (7 days)
const MAX_EXPIRY_SECS = 30 * 24 * 3600; // cap order expiry at 30 days
const authTokens = new Map<string, { owner: string; expires: number }>();
const usedSignatures = new Map<string, number>(); // sig hex → expiry, replay guard

/** Parse a base58 pubkey from untrusted input; returns null instead of throwing. */
function parsePk(s: unknown): PublicKey | null {
  if (typeof s !== "string") return null;
  try { return new PublicKey(s); } catch { return null; }
}

function verifySignIn(b: { owner: string; message: string; signature: number[] }): string | null {
  // The message must be OUR sign-in format, for THIS owner, fresh, and unused —
  // otherwise an old/leaked signature could be replayed to mint a token.
  if (!b.message.startsWith("Ghost Stops — sign-in")) return "unexpected message format";
  const ownerPk = parsePk(b.owner);
  if (!ownerPk) return "invalid owner public key";
  if (b.message.match(/^wallet: (.+)$/m)?.[1] !== b.owner) return "message wallet does not match owner";
  const issued = Date.parse(b.message.match(/^issued: (.+)$/m)?.[1] ?? "");
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > AUTH_MAX_AGE_MS) return "message too old";
  const ok = nacl.sign.detached.verify(new TextEncoder().encode(b.message), Uint8Array.from(b.signature), ownerPk.toBytes());
  if (!ok) return "signature verification failed";
  const sigKey = Buffer.from(b.signature).toString("hex");
  if (usedSignatures.has(sigKey)) return "signature already used";
  usedSignatures.set(sigKey, Date.now() + AUTH_MAX_AGE_MS);
  return null;
}

/** Owner authenticated by the request's bearer token, or null. */
function authedOwner(req: IncomingMessage): string | null {
  const token = req.headers["x-ghost-auth"];
  if (typeof token !== "string") return null;
  const entry = authTokens.get(token);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.owner;
}

// purge expired auth tokens + used-signature records so memory stays bounded
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authTokens) if (v.expires < now) authTokens.delete(k);
  for (const [k, v] of usedSignatures) if (v < now) usedSignatures.delete(k);
}, 60_000);
sweep.unref();

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
    "Access-Control-Allow-Headers": "Content-Type,x-ghost-auth",
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
  // only read prices from the configured oracle feeds — never an attacker-supplied account
  if (!Object.values(cfg.feeds).some((f) => f.equals(feed))) throw new Error("feed not whitelisted");
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
          feeds: Object.fromEntries(Object.entries(cfg.feeds).map(([k, v]) => [k, v.toBase58()])),
        });
      }

      if (req.method === "POST" && url.pathname === "/auth") {
        const b = JSON.parse(await readBody(req));
        if (typeof b.owner !== "string" || typeof b.message !== "string" || !Array.isArray(b.signature)) {
          return json(res, 400, { error: "owner (string), message (string), signature[] required" });
        }
        const fail = verifySignIn(b);
        if (fail) return json(res, 403, { error: fail });
        const token = randomBytes(24).toString("hex");
        authTokens.set(token, { owner: b.owner, expires: Date.now() + TOKEN_TTL_MS });
        log(`sign-in verified for ${b.owner}`);
        return json(res, 200, { token });
      }

      if (req.method === "POST" && url.pathname === "/session") {
        const b = JSON.parse(await readBody(req));
        if (typeof b.owner !== "string" || !Array.isArray(b.secretKey) || typeof b.sessionToken !== "string" || typeof b.validUntil !== "number") {
          return json(res, 400, { error: "owner, secretKey[], sessionToken, validUntil required" });
        }
        // Defense in depth: only the wallet that completed the signed-message
        // sign-in may register a session for itself.
        if (authedOwner(req) !== b.owner) return json(res, 401, { error: "sign-in required before registering a session" });
        const ownerPk = parsePk(b.owner);
        if (!ownerPk) return json(res, 400, { error: "invalid owner public key" });
        const nowSec = Math.floor(Date.now() / 1000);
        if (b.validUntil <= nowSec || b.validUntil > nowSec + MAX_SESSION_HOURS * 3600) {
          return json(res, 400, { error: "validUntil out of range" });
        }
        // Authenticity check — the SessionTokenV2 PDA must derive from exactly
        // (signer, owner) and exist on mainnet (which required the owner wallet's
        // signature at creation). A spoofed owner cannot register a session.
        let signerPk: PublicKey;
        try {
          signerPk = Keypair.fromSecretKey(Uint8Array.from(b.secretKey)).publicKey;
        } catch {
          return json(res, 400, { error: "malformed secretKey" });
        }
        const expected = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode("session_token_v2"), MAGIC_TRADE.toBytes(), signerPk.toBytes(), ownerPk.toBytes()],
          SESSION_KEYS_PROGRAM
        )[0];
        if (expected.toBase58() !== b.sessionToken) {
          return json(res, 403, { error: "sessionToken does not derive from this owner+signer" });
        }
        if (!(await mainnet.getAccountInfo(expected))) {
          return json(res, 403, { error: "session token not found on-chain" });
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
        if (typeof b.owner !== "string") return json(res, 400, { error: "owner required" });
        if (authedOwner(req) !== b.owner) return json(res, 401, { error: "sign-in required — connect your wallet again" });
        if (!sessions.get(b.owner)) return json(res, 400, { error: "no valid session for owner — enable one-click trading first" });
        const kind = b.kind === "fixed" ? 1 : 0;
        const trailingBps = Math.max(0, Math.min(5000, Number(b.trailingBps ?? 0)));
        if (kind === 0 && (trailingBps < 10 || trailingBps > 5000)) {
          return json(res, 400, { error: "trailingBps must be 10..5000" });
        }
        let triggerPrice = 0n;
        if (b.triggerPrice !== undefined && b.triggerPrice !== null) {
          const t = Number(b.triggerPrice);
          if (!Number.isFinite(t) || t < 0) return json(res, 400, { error: "triggerPrice must be a finite number" });
          triggerPrice = BigInt(Math.round(t * 1e8));
        }
        if (kind === 1 && triggerPrice <= 0n) return json(res, 400, { error: "triggerPrice required for fixed orders" });
        const live = await readFeedPrice(feed);
        const rawExpiry = Number(b.expirySecs);
        const expiry = Number.isFinite(rawExpiry) && rawExpiry > 0
          ? Math.floor(Date.now() / 1000) + Math.min(Math.floor(rawExpiry), MAX_EXPIRY_SECS)
          : 0;
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
          expiry,
          isLong: b.isLong !== false,
        });
        log(`order created for ${b.owner}: ${result.pda} (${market} ${kind === 0 ? `trail ${trailingBps}bps` : `fixed @ ${b.triggerPrice}`})`);
        return json(res, 200, result);
      }

      const cancelMatch = /^\/orders\/([1-9A-HJ-NP-Za-km-z]{32,44})\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && cancelMatch) {
        const pdaPk = parsePk(cancelMatch[1]);
        if (!pdaPk) return json(res, 400, { error: "invalid order PDA" });
        const acc = await orders.conn.getAccountInfo(pdaPk);
        if (!acc) return json(res, 200, { ok: true, note: "already gone" }); // idempotent: nothing to cancel
        const order = orders.decode(pdaPk, acc.data as Buffer);
        // Only the order's authenticated owner may cancel it.
        if (authedOwner(req) !== order.owner) return json(res, 401, { error: "sign-in required — only the order owner can cancel" });
        await orders.cancelOrder(order.pda);
        await orders.cancelTick(order.orderId).catch(() => undefined);
        log(`order cancelled via API: ${order.pda}`);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: "not found" });
    } catch (e) {
      log(`API error ${req.method} ${req.url}: ${(e as Error).message}`);
      return json(res, 500, { error: "internal error" }); // never leak internals to the caller
    }
  })();
});

log(`Ghost Stops executor up — program ${cfg.programId.toBase58()}`);
log(`executor key ${cfg.executorKeypair.publicKey.toBase58()} (pays devnet rent; holds only scoped sessions)`);
subscribe();
await reconcile();
setInterval(() => void reconcile(), 30_000);
server.listen(cfg.controlPort, () => log(`control API on :${cfg.controlPort}`));
