// ─────────────────────────────────────────────────────────────────────────────
// lib/ghost.ts — the Ghost Stops side of the app: talk to the executor's
// control API (which creates/delegates/cranks orders on the devnet ER and
// pays all rent — the user signs NOTHING extra), and stream live order state
// straight from the Ephemeral Rollup.
// ─────────────────────────────────────────────────────────────────────────────

import { Connection, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LoadedSession } from "@/lib/session";

// Strip trailing slash(es): the executor matches exact paths (`/session`,
// `/orders`), so a base URL ending in "/" would produce "//session" and 404.
export const EXECUTOR_URL = (process.env.NEXT_PUBLIC_EXECUTOR_URL ?? "http://localhost:8787").replace(/\/+$/, "");
export const GHOST_PROGRAM = new PublicKey(
  process.env.NEXT_PUBLIC_GHOST_PROGRAM ?? "y8gjZcwDHqZ8Sz2Uziw5nxr2cWKGyAKaqtNAUJ2mKxh"
);
const GHOST_ER_RPC = process.env.NEXT_PUBLIC_GHOST_ER_RPC ?? "https://devnet.magicblock.app";

/** One ER connection for ghost-order reads + subscriptions. */
export const ghostEr = new Connection(GHOST_ER_RPC, { commitment: "confirmed" });

export const GHOST_STATES = ["active", "fired", "executed", "cancelled", "failed"] as const;
export type GhostState = (typeof GHOST_STATES)[number];

export interface GhostOrder {
  pda: string;
  owner: string;
  orderId: string;
  kind: "trailing" | "fixed";
  market: string;
  trailingBps: number;
  highWaterMark: number; // raw 1e8 units
  triggerPrice: number;
  triggerAbove: boolean;
  sizePctBps: number;
  expiry: number;
  state: GhostState;
  firedPrice: number;
  isLong: boolean;
}

/** Stop level implied by current HWM (raw units) — mirror of the on-chain math. */
export function ghostStopLevel(o: GhostOrder): number {
  if (o.kind === "fixed") return o.triggerPrice;
  const delta = Math.trunc(o.highWaterMark / 10_000) * o.trailingBps;
  return o.isLong ? o.highWaterMark - delta : o.highWaterMark + delta;
}

export const rawToUi = (raw: number): number => raw / 1e8;

/** Manual borsh decode of the Order account (layout owned by our program). */
export function decodeGhostOrder(pda: PublicKey, data: Uint8Array): GhostOrder | null {
  try {
    if (data.length < 150) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let off = 8; // anchor discriminator
    const pub = () => {
      const k = new PublicKey(data.slice(off, off + 32));
      off += 32;
      return k;
    };
    const u64 = () => {
      const v = view.getBigUint64(off, true);
      off += 8;
      return v;
    };
    const i64 = () => {
      const v = view.getBigInt64(off, true);
      off += 8;
      return v;
    };
    const u16 = () => {
      const v = view.getUint16(off, true);
      off += 2;
      return v;
    };
    const u8 = () => view.getUint8(off++);

    const owner = pub();
    pub(); // executor — not needed client-side
    const orderId = u64();
    const kind = u8();
    const market = new TextDecoder().decode(data.slice(off, off + 8)).replace(/\0+$/, "");
    off += 8;
    pub(); // price_feed
    const trailingBps = u16();
    const hwm = i64();
    const triggerPrice = i64();
    const triggerAbove = u8() === 1;
    const sizePctBps = u16();
    const hasOco = u8() === 1;
    if (hasOco) off += 32;
    const expiry = i64();
    const state = u8();
    const firedPrice = i64();
    const isLong = u8() === 1;

    if (state > 4 || kind > 1) return null;
    return {
      pda: pda.toBase58(),
      owner: owner.toBase58(),
      orderId: orderId.toString(),
      kind: kind === 0 ? "trailing" : "fixed",
      market,
      trailingBps,
      highWaterMark: Number(hwm),
      triggerPrice: Number(triggerPrice),
      triggerAbove,
      sizePctBps,
      expiry: Number(expiry),
      state: GHOST_STATES[state]!,
      firedPrice: Number(firedPrice),
      isLong,
    };
  } catch {
    return null;
  }
}

// ── executor API ──────────────────────────────────────────────────────────────

const AUTH_TOKEN_KEY = "ghost-auth-token";

function storedAuth(): { owner: string; token: string } | null {
  if (typeof window === "undefined") return null;
  try {
    // localStorage so the sign-in survives across tabs/reloads (parity with the
    // session keypair, which is also in localStorage) — otherwise a 2nd tab forces
    // a fresh signMessage and flashes "stops are paused". Migrate a legacy per-tab
    // sessionStorage token on first read.
    let raw = window.localStorage.getItem(AUTH_TOKEN_KEY);
    if (!raw) {
      const legacy = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
      if (legacy) {
        window.localStorage.setItem(AUTH_TOKEN_KEY, legacy);
        window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
        raw = legacy;
      }
    }
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasAuthToken(owner: string | null): boolean {
  const a = storedAuth();
  return Boolean(owner && a && a.owner === owner);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const auth = storedAuth();
  const res = await fetch(`${EXECUTOR_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(auth ? { "x-ghost-auth": auth.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  // A 401 means our sign-in token went stale (token expired, or the single-tenant
  // executor restarted and wiped its in-memory tokens). Drop it so the app
  // re-signs-in and re-registers automatically instead of getting stuck.
  if (res.status === 401) clearAuthToken();
  if (!res.ok) throw new Error(json.error ?? `executor API ${res.status}`);
  return json as T;
}

/**
 * Wallet sign-in: one free `signMessage` right after connect. The executor
 * verifies the ed25519 signature and issues the bearer token that authorizes
 * attach/cancel calls for THIS wallet only. No transaction, no fees.
 */
export async function signInWithExecutor(
  owner: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<void> {
  const message = [
    "Ghost Stops — sign-in",
    "",
    `wallet: ${owner}`,
    `issued: ${new Date().toISOString()}`,
    "",
    "This signature verifies wallet ownership for this session.",
    "It is free and does NOT send a transaction.",
  ].join("\n");
  const signature = await signMessage(new TextEncoder().encode(message));
  const { token } = await api<{ token: string }>("/auth", {
    owner,
    message,
    signature: Array.from(signature),
  });
  window.localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify({ owner, token }));
}

/** Hand the scoped session to the executor so stops fire with the tab closed.
 *  The session CANNOT withdraw funds — that's the whole design. */
export function registerSessionWithExecutor(session: LoadedSession): Promise<{ ok: boolean }> {
  return api("/session", {
    owner: session.authority,
    secretKey: Array.from(session.keypair.secretKey),
    sessionToken: session.token,
    validUntil: session.validUntil,
  });
}

export interface CreateGhostInput {
  owner: string;
  market: string;
  kind: "trailing" | "fixed";
  trailingBps?: number;
  triggerPrice?: number; // UI dollars for fixed orders
  triggerAbove?: boolean;
  sizePctBps?: number;
  isLong: boolean;
  expirySecs?: number;
}

export function createGhostOrder(input: CreateGhostInput): Promise<{ pda: string; orderId: string }> {
  return api("/orders", input);
}

export function cancelGhostOrder(pda: string): Promise<{ ok: boolean }> {
  return api(`/orders/${pda}/cancel`, {}); // empty body forces POST (the executor cancel route is POST)
}

// ── live hooks ───────────────────────────────────────────────────────────────

/** Markets Ghost Stops can actually protect — those with a verified MagicBlock
 *  oracle feed on the ER — plus each market's feed PDA (so the chart can read
 *  the real-time oracle directly). Sourced live from the executor's /health so
 *  the client never guesses; defaults to the one known-verified feed (SOL). */
export function useGhostMarkets(): { markets: string[]; feeds: Record<string, string>; reachable: boolean } {
  const [state, setState] = useState<{ markets: string[]; feeds: Record<string, string>; reachable: boolean }>({ markets: ["SOL"], feeds: {}, reachable: false });
  useEffect(() => {
    let dead = false;
    const load = () => {
      fetch(`${EXECUTOR_URL}/health`)
        .then((r) => r.json())
        .then((h: { markets?: unknown; feeds?: unknown }) => {
          if (dead) return;
          if (!Array.isArray(h.markets) || h.markets.length === 0) { setState((s) => ({ ...s, reachable: true })); return; } // executor answered — just no markets payload
          const feeds: Record<string, string> = {};
          if (h.feeds && typeof h.feeds === "object") {
            for (const [k, v] of Object.entries(h.feeds as Record<string, unknown>)) if (typeof v === "string") feeds[k.toUpperCase()] = v;
          }
          setState({ markets: h.markets.map((m) => String(m).toUpperCase()), feeds, reachable: true });
        })
        // executor unreachable/cold — keep last-known markets, flag it so the UI can
        // say "reconnecting" instead of silently looking like SOL-only is a feature limit.
        .catch(() => { if (!dead) setState((s) => ({ ...s, reachable: false })); });
    };
    load();
    const t = setInterval(load, 20_000); // recover from a transient blip
    return () => { dead = true; clearInterval(t); };
  }, []);
  return state;
}

/** All ghost orders for an owner, streamed from the ER (ws + poll fallback). */
export function useGhostOrders(owner: string | null): GhostOrder[] {
  const [orders, setOrders] = useState<Map<string, GhostOrder>>(new Map());

  const refresh = useCallback(async () => {
    if (!owner) return;
    try {
      const accounts = await ghostEr.getProgramAccounts(GHOST_PROGRAM);
      setOrders((prev) => {
        const next = new Map(prev);
        for (const { pubkey, account } of accounts) {
          const o = decodeGhostOrder(pubkey, account.data);
          if (o && o.owner === owner) next.set(o.pda, o);
        }
        return next;
      });
    } catch {
      // ER hiccup — keep last known state; next poll retries
    }
  }, [owner]);

  useEffect(() => {
    setOrders(new Map());
    if (!owner) return;
    void refresh();
    const poll = setInterval(() => void refresh(), 5000);
    let subId: number | null = null;
    try {
      subId = ghostEr.onProgramAccountChange(
        GHOST_PROGRAM,
        (info) => {
          const o = decodeGhostOrder(info.accountId, info.accountInfo.data);
          if (o && o.owner === owner) {
            setOrders((prev) => new Map(prev).set(o.pda, o));
          }
        },
        { commitment: "confirmed" }
      );
    } catch {
      // ws unavailable — poll covers it
    }
    return () => {
      clearInterval(poll);
      if (subId !== null) void ghostEr.removeProgramAccountChangeListener(subId).catch(() => undefined);
    };
  }, [owner, refresh]);

  return [...orders.values()].sort((a, b) => Number(b.orderId) - Number(a.orderId));
}

export interface TickStats {
  count: number;
  perSecond: number;
  lastSlot: number | null;
}

/** Proof-of-crank: count tick TRANSACTIONS hitting an order PDA on the ER.
 *  (Account-change events only fire on writes; the tx log shows every tick.) */
export function useTickStats(pda: string | null): TickStats {
  const [stats, setStats] = useState<TickStats>({ count: 0, perSecond: 0, lastSlot: null });
  const prev = useRef<{ count: number; at: number } | null>(null);

  useEffect(() => {
    prev.current = null;
    setStats({ count: 0, perSecond: 0, lastSlot: null });
    if (!pda) return;
    const key = new PublicKey(pda);
    const tick = async () => {
      try {
        const sigs = await ghostEr.getSignaturesForAddress(key, { limit: 1000 });
        const now = Date.now();
        const count = sigs.length;
        const perSecond = prev.current && now > prev.current.at
          ? Math.max(0, ((count - prev.current.count) * 1000) / (now - prev.current.at))
          : 0;
        prev.current = { count, at: now };
        setStats({ count, perSecond, lastSlot: sigs[0]?.slot ?? null });
      } catch {
        // keep last stats on RPC hiccup
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => clearInterval(t);
  }, [pda]);

  return stats;
}

export interface Tick {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: boolean;
}

/** Live scrolling feed of the crank-tick TRANSACTIONS hitting an order PDA on the
 *  ER — each one links to the MagicBlock explorer. Incremental: every poll fetches
 *  only signatures newer than the last seen, de-duped, newest-first, capped. Gate
 *  on a non-null pda (only stream the card/modal that's actually open). */
export function useTickStream(pda: string | null, max = 24): Tick[] {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const newest = useRef<string | undefined>(undefined);

  useEffect(() => {
    seen.current = new Set();
    newest.current = undefined;
    setTicks([]);
    if (!pda) return;
    const key = new PublicKey(pda);
    const tick = async () => {
      try {
        const sigs = await ghostEr.getSignaturesForAddress(
          key,
          newest.current ? { until: newest.current, limit: 100 } : { limit: max },
        );
        if (sigs.length === 0) return;
        const fresh = sigs
          .filter((s) => !seen.current.has(s.signature))
          .map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, err: s.err != null }));
        if (fresh.length === 0) return;
        for (const f of fresh) seen.current.add(f.signature);
        newest.current = sigs[0]!.signature; // newest-first
        setTicks((p) => [...fresh, ...p].slice(0, max));
      } catch {
        // keep last on RPC hiccup — same posture as useTickStats
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1000);
    return () => clearInterval(t);
  }, [pda, max]);

  return ticks;
}

/** Freshest SUCCESSFUL signature touching the Ghost program on the ER — so the
 *  About page's "verify on-chain" link is always a real, recent crank tx and can
 *  never go stale (unlike a hardcoded signature, which the ER may eventually
 *  prune). Returns null until it resolves, so callers fall back to a static sig. */
export function useLatestCrankSig(enabled: boolean): string | null {
  const [sig, setSig] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    void (async () => {
      try {
        const sigs = await ghostEr.getSignaturesForAddress(GHOST_PROGRAM, { limit: 12 });
        const fresh = sigs.find((s) => s.err == null)?.signature; // skip "no trigger" ticks that error
        if (!dead && fresh) setSig(fresh);
      } catch { /* keep null → caller uses its static fallback */ }
    })();
    return () => { dead = true; };
  }, [enabled]);
  return sig;
}

// Trades live on Flash's ER; deposits/withdrawals on base mainnet. Separate
// read-only connections (inlined env — FLASH_ER_RPC for trades, base RPC for
// funds — avoids a flash.ts import cycle) so the History panel can pull the
// wallet's real on-chain activity from ANY device, not just this browser's log.
const flashErConn = new Connection(process.env.NEXT_PUBLIC_ER_RPC ?? "https://flash.magicblock.xyz", { commitment: "confirmed" });
const baseConn = new Connection(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://solana-rpc.publicnode.com", { commitment: "confirmed" });

export interface ChainTx { signature: string; slot: number; blockTime: number | null; err: boolean; source: "trade" | "fund" }

/** Wallet-bound on-chain history for the History side panel: the basket's recent
 *  signatures on the Flash ER (trades) + base mainnet (deposits/withdrawals),
 *  merged newest-first. Fetches only while `open` so closed panels cost nothing. */
export function useOnchainHistory(basket: string | null, open: boolean): { items: ChainTx[]; loading: boolean } {
  const [items, setItems] = useState<ChainTx[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !basket) { setItems([]); setLoading(false); return; }
    let dead = false;
    let key: PublicKey;
    try { key = new PublicKey(basket); } catch { setItems([]); setLoading(false); return; }
    setLoading(true);
    void (async () => {
      try {
        const [trades, funds] = await Promise.all([
          flashErConn.getSignaturesForAddress(key, { limit: 40 }).catch(() => []),
          baseConn.getSignaturesForAddress(key, { limit: 25 }).catch(() => []),
        ]);
        if (dead) return;
        const tag = (arr: { signature: string; slot: number; blockTime?: number | null; err: unknown }[], source: "trade" | "fund"): ChainTx[] =>
          arr.map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, err: s.err != null, source }));
        const merged = [...tag(trades, "trade"), ...tag(funds, "fund")]
          .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0))
          .slice(0, 60);
        setItems(merged);
      } catch { if (!dead) setItems([]); }
      finally { if (!dead) setLoading(false); }
    })();
    return () => { dead = true; };
  }, [basket, open]);
  return { items, loading };
}
