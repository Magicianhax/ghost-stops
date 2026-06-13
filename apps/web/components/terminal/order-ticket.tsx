// components/terminal/order-ticket.tsx — the order entry rail. Always present
// (not a state-machine button): pick a side, size, and leverage, then Open.
// The primary control adapts to account state (connect / enable / deposit /
// open). Distinct from the example's tap-zone: this is a deliberate ticket.

"use client";

import type { TradeType } from "flash-v2";
import { useEffect, useMemo, useState } from "react";
import { flash, COLLATERAL } from "@/lib/flash";
import type { MarketLimits } from "@/lib/hooks";
import { fmtUsd } from "@/lib/format";

type Ready = "connect" | "enable" | "deposit" | "ready";

function useFeePreview(sizeUsd: string, leverage: number, market: string): string | null {
  const [fee, setFee] = useState<string | null>(null);
  useEffect(() => {
    setFee(null);
    const size = Number(sizeUsd);
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(leverage) || leverage <= 0) return;
    let dead = false;
    const t = setTimeout(() => {
      flash
        .openPosition({ inputTokenSymbol: COLLATERAL, outputTokenSymbol: market, inputAmountUi: String(size), leverage, tradeType: "LONG", orderType: "MARKET" })
        .then((q) => { if (!dead) setFee(q.entryFee); })
        .catch(() => { if (!dead) setFee(null); });
    }, 400);
    return () => { dead = true; clearTimeout(t); };
  }, [sizeUsd, leverage, market]);
  return fee;
}

const LEV_PRESETS = [2, 5, 10, 20];

export function OrderTicket({
  market,
  ready,
  limits,
  freeUsd,
  busy,
  onConnect,
  onEnable,
  onDeposit,
  onOpen,
}: {
  market: string;
  ready: Ready;
  limits: MarketLimits | null;
  /** USDC free to trade in the basket. */
  freeUsd: number | null;
  busy: TradeType | null;
  onConnect: () => void;
  onEnable: () => void;
  onDeposit: () => void;
  onOpen: (side: TradeType, sizeUsd: string, leverage: number) => void;
}) {
  const [side, setSide] = useState<TradeType>("LONG");
  const [sizeUsd, setSizeUsd] = useState("");
  const [lev, setLev] = useState(5);

  const maxLev = limits?.maxLeverage ?? 100;
  const minLev = limits?.minLeverage ?? 1.1;
  const fee = useFeePreview(sizeUsd, lev, market);
  const presets = useMemo(() => LEV_PRESETS.filter((p) => p <= maxLev), [maxLev]);
  const sizeNum = Number(sizeUsd) || 0;
  const long = side === "LONG";
  const canOpen = ready === "ready" && sizeNum > 0 && lev >= minLev && busy === null;

  const fillPct = ((Math.min(lev, maxLev) - minLev) / Math.max(0.001, maxLev - minLev)) * 100;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* side toggle */}
      <div className="grid grid-cols-2 gap-px bg-edge">
        {(["SHORT", "LONG"] as const).map((s) => {
          const active = side === s;
          const isLong = s === "LONG";
          return (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`py-2.5 font-display text-[12px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                active
                  ? isLong
                    ? "bg-long/15 text-long"
                    : "bg-short/15 text-short"
                  : "bg-panel text-faint hover:text-dim"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* amount */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="font-display text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">size</span>
          <button
            onClick={() => freeUsd && freeUsd > 0 && setSizeUsd(String(Math.floor(freeUsd * 100) / 100))}
            disabled={!freeUsd || freeUsd <= 0}
            className="font-mono text-[10px] tabular-nums text-dim transition-colors hover:text-long disabled:opacity-40"
            title="Use full balance"
          >
            free {freeUsd === null ? "—" : `$${freeUsd.toFixed(2)}`}
          </button>
        </div>
        <label className="flex items-center gap-2 border border-edge bg-bg/60 px-3 py-2.5 transition-colors focus-within:border-long/50">
          <span className="font-mono text-sm text-faint">$</span>
          <input
            value={sizeUsd}
            onChange={(e) => setSizeUsd(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
            placeholder="0"
            inputMode="decimal"
            aria-label="Order size in USDC"
            className="w-full bg-transparent font-mono text-lg tabular-nums text-ink outline-none placeholder:text-faint"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">usdc</span>
        </label>
      </div>

      {/* leverage */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="font-display text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">leverage</span>
          <span className="font-mono text-[11px] tabular-nums text-ink">{lev.toFixed(lev < 10 ? 1 : 0)}×</span>
        </div>
        <input
          type="range"
          min={minLev}
          max={maxLev}
          step={0.1}
          value={lev}
          onChange={(e) => setLev(Number(e.target.value))}
          className="lev-range w-full"
          style={{ background: `linear-gradient(90deg, var(--color-long) ${fillPct}%, var(--color-edge2) ${fillPct}%)` }}
          aria-label="Leverage"
        />
        <div className="mt-2 grid grid-cols-4 gap-px bg-edge">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setLev(p)}
              className={`py-1.5 font-mono text-[10px] tabular-nums transition-colors ${
                Math.round(lev) === p ? "bg-long/15 text-long" : "bg-panel text-dim hover:text-ink"
              }`}
            >
              {p}×
            </button>
          ))}
        </div>
      </div>

      {/* summary line */}
      <div className="flex items-baseline justify-between border-t border-edge pt-2.5 font-mono text-[10px] text-dim">
        <span>entry fee</span>
        <span className="tabular-nums text-ink">{fee === null ? "—" : fmtUsd(fee)}</span>
      </div>

      {/* primary action — adapts to state */}
      {ready === "connect" && (
        <button onClick={onConnect} className="h-11 w-full bg-long font-display text-[12px] font-semibold uppercase tracking-[0.16em] text-bg transition-transform active:scale-[0.99]">
          Connect wallet
        </button>
      )}
      {ready === "enable" && (
        <button onClick={onEnable} className="cta-mint h-11 w-full font-display text-[12px] font-semibold uppercase tracking-[0.16em] transition-transform active:scale-[0.99]">
          Enable one-click trading
        </button>
      )}
      {ready === "deposit" && (
        <button onClick={onDeposit} className="h-11 w-full bg-long font-display text-[12px] font-semibold uppercase tracking-[0.16em] text-bg transition-transform active:scale-[0.99]">
          Deposit USDC
        </button>
      )}
      {ready === "ready" && (
        <button
          onClick={() => canOpen && onOpen(side, sizeUsd, lev)}
          disabled={!canOpen}
          className={`h-11 w-full font-display text-[12px] font-semibold uppercase tracking-[0.18em] text-bg transition-transform active:scale-[0.99] disabled:opacity-30 ${
            long ? "bg-long" : "bg-short"
          }`}
        >
          {busy ? "Opening…" : `Open ${long ? "long" : "short"}`}
        </button>
      )}
    </div>
  );
}
