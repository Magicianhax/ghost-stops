// components/terminal/funds-modal.tsx — explicit deposit / withdraw. User types
// the amount and approves each transfer; funds never move implicitly. Reuses the
// proven two-phase withdraw logic in lib/funds.

"use client";

import { useState } from "react";
import { TermModal } from "@/components/terminal/term-modal";
import type { EnableWalletCtx } from "@/lib/enable";
import { depositUsdc, executeWithdrawalStep, withdrawUsdc, type FundsStep } from "@/lib/funds";
import type { LatencyEntry } from "@/lib/hooks";

export function FundsModal({
  open,
  onClose,
  wallet,
  usdcMint,
  walletUsdc,
  inBasketUsd,
  onLog,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  wallet: EnableWalletCtx | null;
  usdcMint: string | null;
  walletUsdc: number | null;
  inBasketUsd: number | null;
  onLog: (e: Omit<LatencyEntry, "id" | "at">) => void;
  onMoved: () => void;
}) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<FundsStep | null>(null);
  const [pendingExec, setPendingExec] = useState(false);

  const max = tab === "deposit" ? walletUsdc : inBasketUsd;
  const locked = busy;

  const run = async () => {
    if (!wallet || !usdcMint || busy) return;
    const amt = Number(amount);
    if (!(amt > 0)) return;
    setBusy(true);
    setStep(null);
    setPendingExec(false);
    try {
      const fn = tab === "deposit" ? depositUsdc : withdrawUsdc;
      const res = await fn({ wallet, usdcMint, amount: amount, onStep: setStep, onLog });
      if (res.ok) { onMoved(); setAmount(""); }
      else if ("executePending" in res && res.executePending) setPendingExec(true);
    } finally {
      setBusy(false);
    }
  };

  const retryExec = async () => {
    if (!wallet || !usdcMint || busy) return;
    setBusy(true);
    try {
      const res = await executeWithdrawalStep({ wallet, usdcMint, onStep: setStep, onLog });
      if (res.ok) { onMoved(); setPendingExec(false); setAmount(""); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <TermModal open={open} onClose={onClose} title="funds" locked={locked} width="max-w-sm">
      <div className="mb-3 grid grid-cols-2 gap-px bg-edge">
        {(["deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setStep(null); setPendingExec(false); }}
            className={`py-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors ${tab === t ? "bg-long/15 text-long" : "bg-panel text-faint hover:text-dim"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-display text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">amount</span>
        <button
          onClick={() => max && max > 0 && setAmount(String(Math.floor(max * 100) / 100))}
          disabled={!max || max <= 0}
          className="font-mono text-[10px] tabular-nums text-dim transition-colors hover:text-long disabled:opacity-40"
        >
          {tab === "deposit" ? "wallet" : "in basket"} {max === null ? "—" : `$${max.toFixed(2)}`}
        </button>
      </div>
      <label className="flex items-center gap-2 border border-edge bg-bg/60 px-3 py-2.5 focus-within:border-long/50">
        <span className="font-mono text-sm text-faint">$</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
          placeholder="0"
          inputMode="decimal"
          disabled={busy}
          aria-label="Amount in USDC"
          className="w-full bg-transparent font-mono text-lg tabular-nums text-ink outline-none placeholder:text-faint"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">usdc</span>
      </label>

      {step && (
        <p className={`mt-2.5 break-words font-mono text-[10px] ${step.phase === "error" ? "text-short" : "text-dim"}`}>
          {step.note ?? step.label}
        </p>
      )}

      {pendingExec ? (
        <button onClick={() => void retryExec()} disabled={busy} className="mt-3 h-10 w-full bg-long font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-bg active:scale-[0.99] disabled:opacity-40">
          {busy ? "…" : "Execute again"}
        </button>
      ) : (
        <button onClick={() => void run()} disabled={busy || !(Number(amount) > 0) || !wallet} className="mt-3 h-10 w-full bg-long font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-bg active:scale-[0.99] disabled:opacity-40">
          {busy ? "…" : tab === "deposit" ? "Deposit USDC" : "Withdraw USDC"}
        </button>
      )}
    </TermModal>
  );
}
