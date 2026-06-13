// components/terminal/term-header.tsx — the terminal's top rail. Brand mark,
// market selector + live price, connection status, wallet. Hairline-divided
// segments, no floating pills.

"use client";

import { useState } from "react";
import { GhostMark } from "@/components/ghost-mark";
import { WalletBar } from "@/components/terminal/wallet-bar";
import { fmtMs } from "@/lib/format";

export function TermHeader({
  market,
  markets,
  onSelectMarket,
  priceText,
  drift,
  live,
  liveLabel,
  lastErMs,
  walletUsdc,
  inBasketUsd,
  onConnect,
  onOpenFunds,
  onOpenHistory,
}: {
  market: string;
  markets: string[];
  onSelectMarket: (m: string) => void;
  priceText: string | null;
  drift: "up" | "down" | "flat";
  live: boolean;
  liveLabel: string;
  lastErMs: number | null;
  walletUsdc: number | null;
  inBasketUsd: number | null;
  onConnect: () => void;
  onOpenFunds: () => void;
  onOpenHistory: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-stretch border-b border-edge bg-panel">
      {/* brand */}
      <div className="flex items-center gap-2 px-4">
        <GhostMark className="h-4 w-4 text-long" />
        <span className="hidden font-display text-[12px] font-semibold uppercase tracking-[0.16em] text-ink sm:inline">
          Ghost Stops
        </span>
      </div>

      {/* market + price */}
      <div className="relative flex items-center border-l border-edge">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-full items-center gap-2 px-3 transition-colors hover:bg-panel2"
          aria-expanded={open}
        >
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{market}/USDC</span>
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-faint" aria-hidden>
            <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <>
            <button aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
            <div className="thin-scroll absolute left-0 top-full z-40 max-h-72 w-44 overflow-auto border border-edge bg-panel2">
              {markets.map((m) => (
                <button
                  key={m}
                  onClick={() => { onSelectMarket(m); setOpen(false); }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-panel ${m === market ? "text-long" : "text-ink"}`}
                >
                  <span className="font-display text-[11px] font-semibold uppercase tracking-[0.06em]">{m}/USDC</span>
                  {m === market && <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-long">active</span>}
                </button>
              ))}
            </div>
          </>
        )}
        <span className={`px-3 font-mono text-[13px] font-semibold tabular-nums ${drift === "up" ? "text-long" : drift === "down" ? "text-short" : "text-ink"}`}>
          {priceText ?? "—"}
        </span>
      </div>

      {/* status */}
      <button
        onClick={onOpenHistory}
        className="ml-auto flex items-center gap-1.5 border-l border-edge px-3 font-mono text-[11px] tabular-nums text-ink transition-colors hover:bg-panel2"
        title="Session activity"
      >
        {lastErMs === null ? <span className="hidden text-faint sm:inline">— ms</span> : fmtMs(lastErMs)}
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-long" : "soft-pulse bg-faint"}`} />
        <span className="hidden font-display text-[8px] font-semibold uppercase tracking-[0.14em] text-dim md:inline">{liveLabel}</span>
      </button>

      <WalletBar walletUsdc={walletUsdc} inBasketUsd={inBasketUsd} onConnect={onConnect} onOpenFunds={onOpenFunds} onOpenHistory={onOpenHistory} />
    </header>
  );
}
