// ─────────────────────────────────────────────────────────────────────────────
// components/ghost-panel.tsx — the Ghost Stops dock: attach an on-chain
// trailing stop to a live Flash position, then WATCH the Ephemeral Rollup
// trail it — HWM ratcheting, stop line following, validator ticks counting up
// at ~10/sec, zero fees. The whole point of the product, in one panel.
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
  useGhostOrders,
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

function OrderRow({ order, markUi }: { order: GhostOrder; markUi: number | null }) {
  const ticks = useTickStats(order.state === "active" ? order.pda : null);
  const [cancelling, setCancelling] = useState(false);
  const badge = STATE_BADGE[order.state];
  const stop = ghostStopLevel(order);
  const distancePct =
    markUi && markUi > 0 ? Math.abs(markUi - rawToUi(stop)) / markUi * 100 : null;

  return (
    <div className="rounded-md border border-edge bg-panel2 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-ink">
          {order.market} {order.isLong ? "LONG" : "SHORT"}
          {order.kind === "trailing" ? ` · trail ${(order.trailingBps / 100).toFixed(2)}%` : " · fixed"}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] ${badge.cls}`}>
          {badge.text}
        </span>
      </div>

      {order.state === "active" && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-dim">
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
        <div className="mt-1 font-mono text-[10px] text-dim">
          fired at {fmt(order.firedPrice)} → position closed on Flash
        </div>
      )}
      {order.state === "failed" && (
        <div className="mt-1 font-mono text-[10px] text-short">
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
          className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint transition-colors hover:text-short disabled:opacity-50"
        >
          {cancelling ? "cancelling…" : "cancel"}
        </button>
      )}
    </div>
  );
}

export default function GhostPanel({
  owner,
  session,
  positions,
  markUi,
  market,
}: {
  owner: string | null;
  session: LoadedSession | null;
  positions: PositionMetrics[];
  markUi: number | null;
  market: string;
}) {
  const orders = useGhostOrders(owner);
  const [trailBps, setTrailBps] = useState(50);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [open, setOpen] = useState(true);

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
  const doneOrders = useMemo(() => orders.filter((o) => o.state !== "active").slice(0, 4), [orders]);
  const position = positions.find((p) => p.marketSymbol === market) ?? positions[0] ?? null;
  const positionProtected = activeOrders.some(
    (o) => position && o.market === position.marketSymbol && o.isLong === (position.sideUi.toUpperCase() === "LONG")
  );

  if (!owner) return null;

  const attach = async () => {
    if (!position || !session || attaching) return;
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
    <aside className="absolute right-3 top-14 z-20 w-[290px] select-none">
      <div className="rounded-lg border border-edge bg-panel/95 shadow-xl backdrop-blur">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2"
          aria-expanded={open}
        >
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
            👻 Ghost Stops
          </span>
          <span className="font-mono text-[10px] text-faint">
            {activeOrders.length > 0 ? `${activeOrders.length} live` : open ? "–" : "+"}
          </span>
        </button>

        {open && (
          <div className="space-y-2 border-t border-edge px-3 py-2.5">
            <p className="font-mono text-[9.5px] leading-relaxed text-faint">
              on-chain trailing stops · evaluated every 100ms by the MagicBlock
              Ephemeral Rollup itself · zero fees · fills on Flash in ~1s
            </p>

            {session && !registered && (
              <p className="font-mono text-[10px] text-short">
                executor unreachable — stops can&apos;t fire. Is the executor running?
              </p>
            )}

            {/* attach form — only when there's a live position to protect */}
            {position && session && registered && !positionProtected && (
              <div className="rounded-md border border-edge2 bg-panel2 p-2.5">
                <div className="mb-1.5 font-mono text-[10px] text-dim">
                  protect {position.marketSymbol} {position.sideUi.toUpperCase()} (${position.sizeUsdUi})
                </div>
                <div className="mb-2 flex gap-1">
                  {TRAIL_PRESETS.map((p) => (
                    <button
                      key={p.bps}
                      onClick={() => setTrailBps(p.bps)}
                      className={`flex-1 rounded border px-1 py-1 font-mono text-[10px] transition-colors ${
                        trailBps === p.bps
                          ? "border-long/60 bg-long/10 text-long"
                          : "border-edge text-dim hover:border-edge2"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => void attach()}
                  disabled={attaching}
                  className="w-full rounded-md border border-long/50 bg-long/15 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-long transition-transform active:scale-[0.98] disabled:opacity-50"
                >
                  {attaching ? "attaching…" : `attach trailing stop ${(trailBps / 100).toFixed(1)}%`}
                </button>
              </div>
            )}

            {position && positionProtected && (
              <p className="font-mono text-[10px] text-long">position protected ✓</p>
            )}
            {!position && activeOrders.length === 0 && (
              <p className="font-mono text-[10px] text-faint">open a position to protect it</p>
            )}
            {!session && <p className="font-mono text-[10px] text-faint">enable one-click trading first</p>}

            {error && <p className="break-all font-mono text-[10px] text-short">{error}</p>}

            {(activeOrders.length > 0 || doneOrders.length > 0) && (
              <div className="space-y-1.5">
                {activeOrders.map((o) => (
                  <OrderRow key={o.pda} order={o} markUi={markUi} />
                ))}
                {doneOrders.map((o) => (
                  <OrderRow key={o.pda} order={o} markUi={markUi} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
