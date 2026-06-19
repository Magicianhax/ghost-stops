// components/gummy/order-card.tsx — a Ghost Stop as a chunky order card: status
// pill, peak/stop stats, the trail progress bar, and the live on-chain eval
// counter. Used in the Stops drawer.

"use client";

import { useEffect, useRef, useState } from "react";
import { ghostStopLevel, rawToUi, useTickStats, useTickStream, type GhostOrder } from "@/lib/ghost";
import { explorerLink, GHOST_ER_RPC, shortKey } from "@/lib/format";
import { playSound } from "@/lib/sound";

const PILL: Record<GhostOrder["state"], { cls: string; text: string }> = {
  active: { cls: "st-trailing", text: "trailing" },
  fired: { cls: "st-fired", text: "fired" },
  executed: { cls: "st-executed", text: "executed" },
  cancelled: { cls: "st-cancelled", text: "cancelled" },
  failed: { cls: "st-failed", text: "failed" },
};

const usd = (raw: number) => `$${rawToUi(raw).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function OrderCard({ order, markUi, entryUi = null, onCancel, onOpen }: { order: GhostOrder; markUi: number | null; entryUi?: number | null; onCancel: (pda: string) => void; onOpen?: (market: string) => void }) {
  const ticks = useTickStats(order.state === "active" ? order.pda : null);
  const [cancelling, setCancelling] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const stream = useTickStream(expanded && order.state === "active" ? order.pda : null);
  // never leave the Cancel spinner stuck if the cancel fails (404/network) and the
  // order stays active — a successful cancel re-renders the card into its
  // non-active branch before this fires anyway.
  useEffect(() => {
    if (!cancelling) return;
    const t = setTimeout(() => setCancelling(false), 6000);
    return () => clearTimeout(t);
  }, [cancelling]);
  // flash the peak/stop the moment the high-water mark makes a favorable new
  // extreme — the visible "it just trailed" beat.
  const [trailed, setTrailed] = useState(false);
  const prevHwm = useRef(order.highWaterMark);
  useEffect(() => {
    const advanced = order.isLong ? order.highWaterMark > prevHwm.current : order.highWaterMark < prevHwm.current;
    prevHwm.current = order.highWaterMark;
    if (!advanced || order.state !== "active") return;
    setTrailed(true);
    playSound("trail");
    const t = setTimeout(() => setTrailed(false), 900);
    return () => clearTimeout(t);
  }, [order.highWaterMark, order.isLong, order.state]);
  const live = order.state === "active";
  const pill = PILL[order.state];
  const stop = ghostStopLevel(order);
  const stopUi = rawToUi(stop), peakUi = rawToUi(order.highWaterMark);
  // once the stop crosses to the profit side of entry, profit is LOCKED — report
  // the guaranteed move it has banked (honest %, no notional needed).
  const lockedPct = live && entryUi && entryUi > 0 && (order.isLong ? stopUi >= entryUi : stopUi <= entryUi)
    ? (Math.abs(stopUi - entryUi) / entryUi) * 100 : null;
  const trailFrac = order.trailingBps / 10000;
  // how close price is to the stop, as a fill of the trail band (fuller = nearer)
  let fill = 0;
  if (markUi && peakUi > 0 && trailFrac > 0) {
    const dist = Math.abs(markUi - stopUi) / Math.max(markUi, 1);
    fill = Math.max(0, Math.min(1, 1 - dist / trailFrac));
  }

  return (
    <div className={`order-card${onOpen ? " oc-clickable" : ""}`} onClick={onOpen ? () => onOpen(order.market) : undefined} role={onOpen ? "button" : undefined} title={onOpen ? `Open ${order.market}` : undefined}>
      <div className="oc-head">
        <span className="oc-title">{order.market} {order.isLong ? "LONG" : "SHORT"} · trail {(order.trailingBps / 100).toFixed(2)}%</span>
        <span className={`status-pill ${pill.cls}`}>{pill.text}</span>
        {onOpen && <span className="oc-go">›</span>}
      </div>
      {live ? (
        <>
          <div className="oc-grid">
            <div className={`oc-stat${trailed ? " bumped" : ""}`}><div className="k">peak {trailed && <span className="trail-tick">▲ trailed</span>}</div><div className="v num">{usd(order.highWaterMark)}</div></div>
            <div className={`oc-stat${trailed ? " bumped" : ""}`}><div className="k">stop</div><div className="v num" style={{ color: "var(--accent)" }}>{usd(stop)}</div></div>
          </div>
          {lockedPct != null && <div className="oc-locked">🔒 +{lockedPct.toFixed(1)}% locked in — your stop is past entry, this trade can&apos;t go red.</div>}
          <div className="trail-bar"><div className="trail-fill" style={{ width: `${(fill * 100).toFixed(1)}%` }} /></div>
          <div className="eval-line">
            <span>watching live, on-chain</span>
            <span className="eval-count">{ticks.count >= 1000 ? "1000+" : ticks.count} checks {ticks.perSecond > 0 ? `· ${ticks.perSecond.toFixed(0)}/s` : ""}</span>
          </div>
          <button className="oc-ticks-toggle" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
            {expanded ? "hide live ticks ▲" : "show live ticks ↗"}
          </button>
          {expanded && (
            <ul className="tick-stream" onClick={(e) => e.stopPropagation()}>
              {stream.length === 0
                ? <li className="tick-empty">waiting for the next on-chain tick…</li>
                : stream.map((t) => (
                  <li key={t.signature}>
                    <a href={explorerLink(t.signature, GHOST_ER_RPC, "tx")} target="_blank" rel="noreferrer" className={t.err ? "tick-row tick-err" : "tick-row"}>
                      <span className="tick-slot">tick · slot {t.slot}</span>
                      <span className="tick-sig">{shortKey(t.signature, 5)} ↗</span>
                    </a>
                  </li>
                ))}
            </ul>
          )}
          <div className="oc-actions">
            <button className="btn btn--ghost btn--block" disabled={cancelling} onClick={(e) => { e.stopPropagation(); setCancelling(true); onCancel(order.pda); }}>
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
      <a
        className="oc-onchain"
        href={explorerLink(order.pda, GHOST_ER_RPC, "address")}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="View this order account + its live crank ticks on Solana Explorer (MagicBlock ER)"
      >
        ⛓ on-chain {live ? "· live ticks" : "order"} · {shortKey(order.pda)} ↗
      </a>
    </div>
  );
}
