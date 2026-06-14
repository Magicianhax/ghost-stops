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
    const raw = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
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
  if (typeof window !== "undefined") window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
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
  window.sessionStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify({ owner, token }));
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
export function useGhostMarkets(): { markets: string[]; feeds: Record<string, string> } {
  const [state, setState] = useState<{ markets: string[]; feeds: Record<string, string> }>({ markets: ["SOL"], feeds: {} });
  useEffect(() => {
    let dead = false;
    fetch(`${EXECUTOR_URL}/health`)
      .then((r) => r.json())
      .then((h: { markets?: unknown; feeds?: unknown }) => {
        if (dead || !Array.isArray(h.markets) || h.markets.length === 0) return;
        const feeds: Record<string, string> = {};
        if (h.feeds && typeof h.feeds === "object") {
          for (const [k, v] of Object.entries(h.feeds as Record<string, unknown>)) if (typeof v === "string") feeds[k.toUpperCase()] = v;
        }
        setState({ markets: h.markets.map((m) => String(m).toUpperCase()), feeds });
      })
      .catch(() => undefined); // executor down — keep the safe default
    return () => { dead = true; };
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
