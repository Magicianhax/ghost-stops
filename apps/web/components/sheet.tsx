// ─────────────────────────────────────────────────────────────────────────────
// components/sheet.tsx — the one CENTERED modal: scale+fade, backdrop
// tap-to-close, Escape, ✕ button, max-h-[80dvh]. THE HARD PART: content stays
// MOUNTED while hidden (opacity-0 + pointer-events-none) so live state inside
// (fee previews, step rows) never resets mid-flow.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect } from "react";

export default function Sheet({
  open,
  onClose,
  label,
  locked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  /** True while mid-signing — the sheet must not be escapable then. */
  locked?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        className={`backdrop-fade absolute inset-0 bg-black/60 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={locked ? undefined : onClose}
      />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={`modal-pop w-full max-w-md rounded-xl border border-edge bg-sheet shadow-2xl ${
            open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-edge px-4 pb-2 pt-3">
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-dim">{label}</span>
            {!locked && (
              <button
                onClick={onClose}
                aria-label="Close dialog"
                className="grid h-6 w-6 place-items-center border border-edge text-dim transition-colors hover:border-edge2 hover:text-ink"
              >
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
                  <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <div className="thin-scroll max-h-[80dvh] overflow-y-auto px-4 pb-5 pt-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
