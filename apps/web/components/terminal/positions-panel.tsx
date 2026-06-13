// components/terminal/positions-panel.tsx — open positions as a dense table.
// Live PnL for the active market (mark-price math like Flash's own UI); other
// markets fall back to the indexer's with-fee figure. Close / reverse per row.

"use client";

import type { PositionMetrics, TradeType } from "flash-v2";
import { computePositionView, fmtPnlUsd, num } from "@/lib/format";

export function PositionsPanel({
  positions,
  market,
  markUi,
  busyKey,
  onClose,
  onReverse,
}: {
  positions: PositionMetrics[];
  market: string;
  markUi: number | null;
  /** "market:side" currently working, or null. */
  busyKey: string | null;
  onClose: (market: string, side: TradeType) => void;
  onReverse: (market: string, side: TradeType) => void;
}) {
  if (positions.length === 0) {
    return (
      <div className="grid h-full place-items-center px-4 py-8 text-center">
        <p className="max-w-[34ch] font-mono text-[10px] leading-relaxed text-faint">
          No open positions. Open a long or short from the ticket; it appears here with live PnL.
        </p>
      </div>
    );
  }

  return (
    <div className="thin-scroll h-full overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-edge text-faint">
            {["market", "size", "entry", "pnl", "liq", ""].map((h, i) => (
              <th
                key={h || "act"}
                className={`px-3 py-1.5 font-display text-[8.5px] font-semibold uppercase tracking-[0.14em] ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const side = (p.sideUi.toUpperCase() === "SHORT" ? "SHORT" : "LONG") as TradeType;
            const long = side === "LONG";
            const matchesMarket = p.marketSymbol.toUpperCase() === market.toUpperCase();
            const view = matchesMarket ? computePositionView(p, markUi) : null;
            const pnl = view?.pnlUsd ?? num(p.pnlWithFeeUsdUi);
            const key = `${p.marketSymbol}:${side}`;
            const working = busyKey === key;
            return (
              <tr key={key} className="border-b border-edge/60 last:border-0">
                <td className="px-3 py-2 text-left">
                  <span className="font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-ink">{p.marketSymbol}</span>
                  <span className={`ml-1.5 font-mono text-[9px] uppercase ${long ? "text-long" : "text-short"}`}>{long ? "long" : "short"}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-dim">${p.sizeUsdUi}</td>
                <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-dim">${p.entryPriceUi}</td>
                <td className={`px-3 py-2 text-right font-mono text-[11px] font-semibold tabular-nums ${(pnl ?? 0) >= 0 ? "text-long" : "text-short"}`}>
                  {pnl === null ? "—" : fmtPnlUsd(pnl)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-faint">${p.liquidationPriceUi}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => onReverse(p.marketSymbol, side)}
                      disabled={working}
                      className="border border-edge px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-dim transition-colors hover:border-edge2 hover:text-ink disabled:opacity-40"
                      title="Close and open the opposite side"
                    >
                      rev
                    </button>
                    <button
                      onClick={() => onClose(p.marketSymbol, side)}
                      disabled={working}
                      className="border border-edge2 bg-panel2 px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-short/60 hover:text-short disabled:opacity-40"
                    >
                      {working ? "…" : "close"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
