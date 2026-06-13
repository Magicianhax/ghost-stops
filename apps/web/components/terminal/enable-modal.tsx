// components/terminal/enable-modal.tsx — progress view for Enable One-Click
// Trading. Pure display of the EnableState the shell drives; one approval sets
// up session + basket + ledger + delegation. Funds never move here.

"use client";

import { TermModal } from "@/components/terminal/term-modal";
import type { EnableState } from "@/lib/enable";

const DOT: Record<string, string> = {
  idle: "bg-edge2",
  active: "bg-long soft-pulse",
  done: "bg-long",
  skipped: "bg-faint",
  error: "bg-short",
};

export function EnableModal({
  open,
  onClose,
  state,
  enabling,
  onRetry,
  onOpenFunds,
}: {
  open: boolean;
  onClose: () => void;
  state: EnableState | null;
  enabling: boolean;
  onRetry: () => void;
  onOpenFunds: () => void;
}) {
  return (
    <TermModal open={open} onClose={onClose} title="enable one-click trading" locked={enabling} width="max-w-sm">
      <p className="mb-3 font-mono text-[10px] leading-relaxed text-faint">
        One signature sets up your trading account and a scoped session key. No funds move; the only transfer is a 0.01 SOL rent top-up, recoverable when you revoke.
      </p>

      <div className="flex flex-col gap-px bg-edge">
        {(state?.steps ?? [
          { id: "session", label: "session key", status: "idle" },
          { id: "basket", label: "basket", status: "idle" },
          { id: "ledger", label: "deposit ledger", status: "idle" },
          { id: "delegate", label: "delegate to rollup", status: "idle" },
        ]).map((s) => (
          <div key={s.id} className="flex items-center justify-between bg-panel px-3 py-2.5">
            <span className="flex items-center gap-2.5">
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status] ?? "bg-edge2"}`} />
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-ink">{s.label}</span>
            </span>
            <span className={`font-mono text-[9px] ${s.status === "error" ? "text-short" : "text-faint"}`}>
              {s.note ?? (s.ms ? `${s.ms} ms` : s.status)}
            </span>
          </div>
        ))}
      </div>

      {state?.error && (
        <p className="mt-3 break-words font-mono text-[10px] text-short">{state.error}</p>
      )}

      {state?.needsUsdc && !enabling && (
        <button onClick={onOpenFunds} className="mt-3 h-10 w-full bg-long font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-bg active:scale-[0.99]">
          Deposit USDC
        </button>
      )}
      {state?.phase === "stopped" && !enabling && (
        <button onClick={onRetry} className="mt-3 h-10 w-full border border-edge2 bg-panel2 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-ink transition-colors hover:border-long/50 hover:text-long active:scale-[0.99]">
          Retry
        </button>
      )}
    </TermModal>
  );
}
