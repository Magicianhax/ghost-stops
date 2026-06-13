// components/terminal/stops-panel.tsx — Ghost Stops as a first-class panel.
// Attach an on-chain trailing stop to a live position, then watch the rollup
// trail it: peak ratchets, stop follows, validator ticks count up at ~10/sec.
// This is the product, so it sits in the layout, not behind a drawer.

"use client";

import type { PositionMetrics, TradeType } from "flash-v2";
import { useMemo, useState } from "react";
import { ghostStopLevel, rawToUi, useTickStats, type GhostOrder } from "@/lib/ghost";

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

const fmt = (raw: number) =>
  `$${rawToUi(raw).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

function StopRow({ order, markUi, onCancel }: { order: GhostOrder; markUi: number | null; onCancel: (pda: string) => void }) {
  const ticks = useTickStats(order.state === "active" ? order.pda : null);
  const [cancelling, setCancelling] = useState(false);
  const live = order.state === "active";
  const badge = STATE_BADGE[order.state];
  const stop = ghostStopLevel(order);
  const dist = markUi && markUi > 0 ? (Math.abs(markUi - rawToUi(stop)) / markUi) * 100 : null;

  return (
    <div className={live ? "framed framed-mint bg-panel2 px-3 py-2.5" : "border border-edge bg-panel2 px-3 py-2"}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-ink">
            {order.market} {order.isLong ? "LONG" : "SHORT"}
          </span>
          <span className="font-mono text-[10px] text-dim">
            {order.kind === "trailing" ? `trail ${(order.trailingBps / 100).toFixed(2)}%` : "fixed"}
          </span>
        </span>
        <span className={`border px-1.5 py-0.5 font-display text-[8.5px] font-semibold tracking-[0.12em] ${badge.cls} ${order.state === "fired" ? "spark" : ""}`}>
          {badge.text}
        </span>
      </div>
      {live && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px] text-dim">
          <span>peak {fmt(order.highWaterMark)}</span>
          <span>stop {fmt(stop)}</span>
          <span className="text-faint">{dist !== null ? `${dist.toFixed(2)}% away` : "—"}</span>
          <span className="text-faint">{ticks.count >= 1000 ? "1000+" : ticks.count} ticks{ticks.perSecond > 0 ? ` · ${ticks.perSecond.toFixed(1)}/s` : ""}</span>
        </div>
      )}
      {order.state === "executed" && order.firedPrice > 0 && (
        <div className="mt-1.5 font-mono text-[10px] text-dim">fired at {fmt(order.firedPrice)}, position closed on Flash</div>
      )}
      {order.state === "failed" && (
        <div className="mt-1.5 font-mono text-[10px] text-short">execution failed, position untouched</div>
      )}
      {live && (
        <button
          disabled={cancelling}
          onClick={() => { setCancelling(true); onCancel(order.pda); }}
          className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-faint transition-colors hover:text-short disabled:opacity-50"
        >
          {cancelling ? "cancelling…" : "cancel"}
        </button>
      )}
    </div>
  );
}

export function StopsPanel({
  owner,
  enabled,
  registered,
  positions,
  orders,
  markUi,
  market,
  attaching,
  attachError,
  onAttach,
  onCancel,
}: {
  owner: string | null;
  enabled: boolean;
  registered: boolean;
  positions: PositionMetrics[];
  orders: GhostOrder[];
  markUi: number | null;
  market: string;
  attaching: boolean;
  attachError: string | null;
  onAttach: (market: string, side: TradeType, trailingBps: number) => void;
  onCancel: (pda: string) => void;
}) {
  const [trailBps, setTrailBps] = useState(50);
  const active = useMemo(() => orders.filter((o) => o.state === "active"), [orders]);
  const done = useMemo(() => orders.filter((o) => o.state !== "active").slice(0, 5), [orders]);
  const position = positions.find((p) => p.marketSymbol === market) ?? positions[0] ?? null;
  const protectedAlready = active.some((o) => position && o.market === position.marketSymbol && o.isLong === (position.sideUi.toUpperCase() === "LONG"));

  return (
    <div className="thin-scroll flex h-full flex-col gap-2.5 overflow-auto p-3">
      {!owner && <p className="font-mono text-[10px] text-faint">Connect a wallet to begin.</p>}
      {owner && !enabled && <p className="font-mono text-[10px] text-faint">Enable one-click trading to arm stops.</p>}
      {enabled && !registered && <p className="font-mono text-[10px] text-short">Executor unreachable, stops can&apos;t fire.</p>}

      {position && enabled && registered && !protectedAlready && (
        <div className="framed bg-panel2 p-3">
          <div className="mb-2 font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-dim">
            protect {position.marketSymbol} {position.sideUi.toUpperCase()} <span className="text-faint">(${position.sizeUsdUi})</span>
          </div>
          <div className="mb-2.5 grid grid-cols-4 gap-px bg-edge">
            {TRAIL_PRESETS.map((p) => (
              <button
                key={p.bps}
                onClick={() => setTrailBps(p.bps)}
                className={`py-1.5 font-mono text-[10px] tabular-nums transition-colors ${trailBps === p.bps ? "bg-long/15 text-long" : "bg-panel2 text-dim hover:text-ink"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onAttach(position.marketSymbol, position.sideUi.toUpperCase() === "LONG" ? "LONG" : "SHORT", trailBps)}
            disabled={attaching}
            className="w-full border border-long/50 bg-long/15 py-2 font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-long transition-colors hover:bg-long/25 active:scale-[0.98] disabled:opacity-50"
          >
            {attaching ? "attaching…" : `attach trailing stop ${(trailBps / 100).toFixed(1)}%`}
          </button>
          {attachError && <p className="mt-1.5 break-all font-mono text-[9px] text-short">{attachError}</p>}
        </div>
      )}

      {enabled && registered && !position && active.length === 0 && (
        <p className="max-w-[36ch] font-mono text-[10px] leading-relaxed text-faint">
          Open a position, then attach a trailing stop here. It trails on-chain and closes the position when price reverses.
        </p>
      )}
      {protectedAlready && active.length > 0 && (
        <p className="font-mono text-[10px] text-long">Position protected.</p>
      )}

      {active.map((o) => (
        <StopRow key={o.pda} order={o} markUi={markUi} onCancel={onCancel} />
      ))}

      {done.length > 0 && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-display text-[8.5px] font-semibold uppercase tracking-[0.2em] text-faint">history</span>
            <span className="h-px flex-1 bg-edge" aria-hidden />
          </div>
          {done.map((o) => (
            <StopRow key={o.pda} order={o} markUi={markUi} onCancel={onCancel} />
          ))}
        </>
      )}
    </div>
  );
}
