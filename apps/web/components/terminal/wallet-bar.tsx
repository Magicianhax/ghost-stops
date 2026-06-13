// components/terminal/wallet-bar.tsx — WalletBar (account menu / Connect button)
// and WalletPicker (the shared connect modal). No auto-connect: the user picks
// a wallet and connects deliberately. select() is async state, so connect waits
// for the selection to land (the ref dance). The picker is hoisted to the shell
// so both the header button and the order ticket can open it.

"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { TermModal } from "@/components/terminal/term-modal";
import { shortKey } from "@/lib/format";

export function WalletPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, wallet, select, connect, connected, connecting } = useWallet();
  const [mounted, setMounted] = useState(false);
  const wantConnect = useRef(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (wantConnect.current && wallet && !connected && !connecting) {
      wantConnect.current = false;
      connect().catch(() => undefined);
    }
  }, [wallet, connected, connecting, connect]);
  useEffect(() => { if (connected) onClose(); }, [connected, onClose]);

  return (
    <TermModal open={open} onClose={onClose} title="connect wallet" width="max-w-sm">
      <div className="flex flex-col gap-px bg-edge">
        {mounted && wallets.map((w) => {
          const installed = w.readyState === WalletReadyState.Installed;
          return (
            <button
              key={w.adapter.name}
              onClick={() => { wantConnect.current = true; select(w.adapter.name); }}
              className="flex items-center justify-between bg-panel px-3.5 py-3 text-left transition-colors hover:bg-panel2"
            >
              <span className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" className="h-5 w-5" />
                <span className="font-display text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">{w.adapter.name}</span>
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">{installed ? "detected" : "install"}</span>
            </button>
          );
        })}
        {mounted && wallets.length === 0 && (
          <p className="bg-panel px-3.5 py-4 font-mono text-[11px] text-faint">
            No Solana wallet detected. Install Phantom, Solflare, or Backpack.
          </p>
        )}
      </div>
    </TermModal>
  );
}

export function WalletBar({
  walletUsdc,
  inBasketUsd,
  onConnect,
  onOpenFunds,
  onOpenHistory,
}: {
  walletUsdc: number | null;
  inBasketUsd: number | null;
  onConnect: () => void;
  onOpenFunds: () => void;
  onOpenHistory: () => void;
}) {
  const { publicKey, disconnect, connecting } = useWallet();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const pk = publicKey?.toBase58() ?? null;

  const copy = async () => {
    if (!pk) return;
    try { await navigator.clipboard.writeText(pk); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* denied */ }
  };

  if (!pk) {
    return (
      <button onClick={onConnect} className="h-full bg-long px-4 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-bg transition-transform active:scale-[0.99]">
        {connecting ? "Connecting…" : "Connect"}
      </button>
    );
  }

  return (
    <div className="relative flex items-stretch">
      <button onClick={() => setMenu((v) => !v)} aria-expanded={menu} className="flex items-center gap-2 border-l border-edge px-3 text-ink transition-colors hover:bg-panel2">
        {inBasketUsd !== null && (
          <span className="flex items-baseline gap-1" title="USDC deposited in your basket">
            <span className="font-display text-[8px] font-semibold uppercase tracking-[0.12em] text-faint">bal</span>
            <span className="font-mono text-xs tabular-nums text-long">${inBasketUsd.toFixed(2)}</span>
          </span>
        )}
        <span className="hidden font-mono text-[11px] text-dim sm:inline">{shortKey(pk)}</span>
        <svg viewBox="0 0 12 12" className={`h-3 w-3 text-faint transition-transform ${menu ? "rotate-180" : ""}`} aria-hidden>
          <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menu && (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setMenu(false)} />
          <div className="absolute right-0 top-full z-40 mt-px w-52 border border-edge bg-panel2">
            <div className="grid gap-1.5 border-b border-edge px-3.5 py-3">
              {([
                ["wallet usdc", walletUsdc === null ? "—" : `$${walletUsdc.toFixed(2)}`],
                ["in basket", inBasketUsd === null ? "—" : `$${inBasketUsd.toFixed(2)}`],
              ] as Array<[string, string]>).map(([l, v]) => (
                <div key={l} className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">{l}</span>
                  <span className="font-mono text-xs tabular-nums text-ink">{v}</span>
                </div>
              ))}
            </div>
            {([
              ["deposit / withdraw", () => { setMenu(false); onOpenFunds(); }, "text-long"],
              ["history", () => { setMenu(false); onOpenHistory(); }, "text-ink"],
              [copied ? "copied" : "copy address", () => void copy(), "text-ink"],
              ["disconnect", () => { setMenu(false); void disconnect(); }, "text-dim"],
            ] as Array<[string, () => void, string]>).map(([label, fn, cls], i) => (
              <button key={i} onClick={fn} className={`w-full px-3.5 py-2.5 text-left font-mono text-xs transition-colors hover:bg-panel ${cls} ${i > 0 ? "border-t border-edge" : ""}`}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
