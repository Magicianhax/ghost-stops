// components/gummy/order-card.tsx — a Ghost Stop as a chunky order card: status
// pill, peak/stop stats, the trail progress bar, and the live on-chain eval
// counter. Used in the Stops drawer.

"use client";

import { useState } from "react";
import { ghostStopLevel, rawToUi, useTickStats, type GhostOrder } from "@/lib/ghost";

const PILL: Record<GhostOrder["state"], { cls: string; text: string }> = {
  active: { cls: "st-trailing", text: "trailing" },
  fired: { cls: "st-fired", text: "fired" },
  executed: { cls: "st-executed", text: "executed" },
  cancelled: { cls: "st-cancelled", text: "cancelled" },
  failed: { cls: "st-failed", text: "failed" },
};

const usd = (raw: number) => `$${rawToUi(raw).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function OrderCard({ order, markUi, onCancel }: { order: GhostOrder; markUi: number | null; onCancel: (pda: string) => void }) {
  const ticks = useTickStats(order.state === "active" ? order.pda : null);
  const [cancelling, setCancelling] = useState(false);
  const live = order.state === "active";
  const pill = PILL[order.state];
  const stop = ghostStopLevel(order);
  const stopUi = rawToUi(stop), peakUi = rawToUi(order.highWaterMark);
  const trailFrac = order.trailingBps / 10000;
  // how close price is to the stop, as a fill of the trail band (fuller = nearer)
  let fill = 0;
  if (markUi && peakUi > 0 && trailFrac > 0) {
    const dist = Math.abs(markUi - stopUi) / Math.max(markUi, 1);
    fill = Math.max(0, Math.min(1, 1 - dist / trailFrac));
  }

  return (
    <div className="order-card">
      <div className="oc-head">
        <span className="oc-title">{order.market} {order.isLong ? "LONG" : "SHORT"} · trail {(order.trailingBps / 100).toFixed(2)}%</span>
        <span className={`status-pill ${pill.cls}`}>{pill.text}</span>
      </div>
      {live ? (
        <>
          <div className="oc-grid">
            <div className="oc-stat"><div className="k">peak</div><div className="v num">{usd(order.highWaterMark)}</div></div>
            <div className="oc-stat"><div className="k">stop</div><div className="v num" style={{ color: "var(--accent)" }}>{usd(stop)}</div></div>
          </div>
          <div className="trail-bar"><div className="trail-fill" style={{ width: `${(fill * 100).toFixed(1)}%` }} /></div>
          <div className="eval-line">
            <span>evaluated on-chain</span>
            <span className="eval-count">{ticks.count >= 1000 ? "1000+" : ticks.count}× {ticks.perSecond > 0 ? `· ${ticks.perSecond.toFixed(0)}/s` : ""}</span>
          </div>
          <div className="oc-actions">
            <button className="btn btn--ghost btn--block" disabled={cancelling} onClick={() => { setCancelling(true); onCancel(order.pda); }}>
              {cancelling ? "Cancelling…" : "Cancel stop"}
            </button>
          </div>
        </>
      ) : order.state === "executed" ? (
        <div className="muted small" style={{ fontWeight: 700 }}>Fired at {usd(order.firedPrice)} — position closed on Flash.</div>
      ) : order.state === "failed" ? (
        <div className="small" style={{ color: "var(--red)", fontWeight: 700 }}>Execution failed — position untouched.</div>
      ) : (
        <div className="muted small" style={{ fontWeight: 700 }}>Cancelled.</div>
      )}
    </div>
  );
}
