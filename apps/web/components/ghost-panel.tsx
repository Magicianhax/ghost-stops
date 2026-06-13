// ─────────────────────────────────────────────────────────────────────────────
// components/ghost-panel.tsx — Ghost Stops as a RIGHT side drawer (mirror of
// the market drawer): attach an on-chain trailing stop to a live Flash
// position, then WATCH the Ephemeral Rollup trail it — HWM ratcheting, stop
// following, validator ticks counting at ~10/sec, zero fees. Content stays
// MOUNTED while closed so live subscriptions and the executor session
// registration never reset; the top-bar badge stays correct either way.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useMemo, useState } from "react";
import type { PositionMetrics } from "flash-v2";
import {
  cancelGhostOrder,
  createGhostOrder,
  ghostStopLevel,
  rawToUi,
  registerSessionWithExecutor,
  useTickStats,
  type GhostOrder,
} from "@/lib/ghost";
import type { LoadedSession } from "@/lib/session";

const TRAIL_PRESETS = [
  { bps: 10, label: "0.1%" },
  { bps: 50, label: "0.5%" },
  { bps: 100, label: "1%" },
  { bps: 200, label: "2%" },
];

const STATE_BADGE: Record<GhostOrder["state"], { text: string; cls: string }> = {
  active: { text: "TRAILING", cls: "text-long border-long/40" },
  fired: { text: "FIRED", cls: "text-accent border-accent/40" },
  executed: { text: "EXECUTED", cls: "text-long border-long/60" },
  cancelled: { text: "CANCELLED", cls: "text-faint border-edge" },
  failed: { text: "FAILED", cls: "text-short border-short/40" },
};

const fmt = (rawPrice: number) =>
  `$${rawToUi(rawPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

function OrderRow({ order, markUi, idx }: { order: GhostOrder; markUi: number | null; idx: number }) {
  const ticks = useTickStats(order.state === "active" ? order.pda : null);
  const [cancelling, setCancelling] = useState(false);
  const badge = STATE_BADGE[order.state];
  const stop = ghostStopLevel(order);
  const live = order.state === "active";
  const distancePct =
    markUi && markUi > 0 ? (Math.abs(markUi - rawToUi(stop)) / markUi) * 100 : null;

  return (
    <div className={live ? "framed framed-mint bg-panel2 px-3.5 py-3" : "border border-edge bg-panel2 px-3.5 py-2.5"}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[9px] tabular-nums text-faint">{String(idx + 1).padStart(2, "0")}</span>
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
            {order.market} {order.isLong ? "LONG" : "SHORT"}
          </span>
          <span className="font-mono text-[10px] text-dim">
            {order.kind === "trailing" ? `trail ${(order.trailingBps / 100).toFixed(2)}%` : "fixed"}
          </span>
        </span>
        <span
          className={`border px-1.5 py-0.5 font-display text-[9px] font-semibold tracking-[0.12em] ${badge.cls} ${
            order.state === "fired" ? "spark" : ""
          }`}
        >
          {badge.text}
        </span>
      </div>

      {order.state === "active" && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-dim">
          <span>peak {fmt(order.highWaterMark)}</span>
          <span>stop {fmt(stop)}</span>
          <span className="text-faint">{distancePct !== null ? `${distancePct.toFixed(2)}% away` : "—"}</span>
          <span className="text-faint">
            {ticks.count >= 1000 ? "1000+" : ticks.count} ticks
            {ticks.perSecond > 0 ? ` · ${ticks.perSecond.toFixed(1)}/s` : ""}
          </span>
        </div>
      )}

      {order.state === "executed" && order.firedPrice > 0 && (
        <div className="mt-1.5 font-mono text-[10px] text-dim">
          fired at {fmt(order.firedPrice)} → position closed on Flash
        </div>
      )}
      {order.state === "failed" && (
        <div className="mt-1.5 font-mono text-[10px] text-short">
          execution failed — position untouched, check executor
        </div>
      )}

      {order.state === "active" && (
        <button
          disabled={cancelling}
          onClick={() => {
            setCancelling(true);
            cancelGhostOrder(order.pda).catch(() => setCancelling(false));
          }}
          className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-faint transition-colors hover:text-short disabled:opacity-50"
        >
          {cancelling ? "cancelling…" : "cancel"}
        </button>
      )}
    </div>
  );
}

export default function GhostDrawer({
  open,
  onClose,
  owner,
  session,
  positions,
  orders,
  markUi,
  market,
}: {
  open: boolean;
  onClose: () => void;
  owner: string | null;
  session: LoadedSession | null;
  positions: PositionMetrics[];
  /** Live orders from useGhostOrders — lifted to the app so the top-bar badge shares it. */
  orders: GhostOrder[];
  markUi: number | null;
  market: string;
}) {
  const [trailBps, setTrailBps] = useState(50);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Hand the scoped session to the executor once per session token — this is
  // what lets stops fire with the browser closed (session cannot withdraw).
  useEffect(() => {
    setRegistered(false);
    if (!session) return;
    let dead = false;
    registerSessionWithExecutor(session)
      .then(() => !dead && setRegistered(true))
      .catch(() => !dead && setRegistered(false));
    return () => {
      dead = true;
    };
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeOrders = useMemo(() => orders.filter((o) => o.state === "active"), [orders]);
  const doneOrders = useMemo(() => orders.filter((o) => o.state !== "active").slice(0, 6), [orders]);
  const position = positions.find((p) => p.marketSymbol === market) ?? positions[0] ?? null;
  const positionProtected = activeOrders.some(
    (o) => position && o.market === position.marketSymbol && o.isLong === (position.sideUi.toUpperCase() === "LONG")
  );

  const attach = async () => {
    if (!position || !session || attaching || !owner) return;
    setError(null);
    setAttaching(true);
    try {
      await createGhostOrder({
        owner,
        market: position.marketSymbol,
        kind: "trailing",
        trailingBps: trailBps,
        sizePctBps: 10_000,
        isLong: position.sideUi.toUpperCase() === "LONG",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open} inert={!open}>
      <div
        className={`backdrop-fade absolute inset-0 bg-black/60 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ghost stops"
        className={`absolute inset-y-0 right-0 w-[330px] border-l border-edge bg-sheet transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-12 items-center justify-between border-b border-edge px-4">
          <span className="font-display text-[14px] font-semibold text-ink">👻 Ghost Stops</span>
          <button
            onClick={onClose}
            aria-label="close ghost stops"
            className="grid h-6 w-6 place-items-center rounded-[3px] border border-edge text-dim transition-colors hover:border-edge2 hover:text-ink"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
              <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="thin-scroll max-h-[calc(100dvh-3rem)] space-y-3 overflow-y-auto p-4">
          <p className="font-mono text-[10px] leading-relaxed text-faint">
            on-chain trailing stops · evaluated every 100ms by the MagicBlock
            Ephemeral Rollup itself · zero fees · fills on Flash in ~1s
          </p>

          {!owner && <p className="font-mono text-[11px] text-dim">connect a wallet to begin</p>}
          {owner && !session && (
            <p className="font-mono text-[11px] text-dim">enable one-click trading first — stops execute through your scoped session key</p>
          )}
          {session && !registered && (
            <p className="font-mono text-[11px] text-short">
              executor unreachable — stops can&apos;t fire. Is the executor running?
            </p>
          )}

          {/* attach form — only when there's a live position to protect */}
          {position && session && registered && !positionProtected && (
            <div className="framed bg-panel2 p-3.5">
              <div className="mb-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
                protect {position.marketSymbol} {position.sideUi.toUpperCase()}{" "}
                <span className="text-faint">(${position.sizeUsdUi})</span>
              </div>
              <div className="mb-3 grid grid-cols-4 gap-px bg-edge">
                {TRAIL_PRESETS.map((p) => (
                  <button
                    key={p.bps}
                    onClick={() => setTrailBps(p.bps)}
                    className={`py-2 font-mono text-[11px] tabular-nums transition-colors ${
                      trailBps === p.bps
                        ? "bg-long/15 text-long"
                        : "bg-panel2 text-dim hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void attach()}
                disabled={attaching}
                className="w-full border border-long/50 bg-long/15 py-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-long transition-colors hover:bg-long/25 active:scale-[0.98] disabled:opacity-50"
              >
                {attaching ? "attaching…" : `attach trailing stop ${(trailBps / 100).toFixed(1)}%`}
              </button>
            </div>
          )}

          {position && positionProtected && (
            <p className="font-mono text-[11px] text-long">position protected ✓</p>
          )}
          {owner && session && registered && !position && activeOrders.length === 0 && (
            <p className="font-mono text-[11px] text-faint">open a position to protect it</p>
          )}

          {error && <p className="break-all font-mono text-[10px] text-short">{error}</p>}

          {activeOrders.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="font-display text-[9px] font-semibold uppercase tracking-[0.2em] text-long">live</span>
                <span className="h-px flex-1 bg-edge" aria-hidden />
              </div>
              {activeOrders.map((o, i) => (
                <OrderRow key={o.pda} order={o} markUi={markUi} idx={i} />
              ))}
            </div>
          )}
          {doneOrders.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="font-display text-[9px] font-semibold uppercase tracking-[0.2em] text-faint">history</span>
                <span className="h-px flex-1 bg-edge" aria-hidden />
              </div>
              {doneOrders.map((o, i) => (
                <OrderRow key={o.pda} order={o} markUi={markUi} idx={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
