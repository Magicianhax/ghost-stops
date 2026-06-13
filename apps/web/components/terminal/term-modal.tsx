// components/terminal/term-modal.tsx — centered modal. Hard-edged, hairline
// title bar with a square close control, backdrop + Escape close. Content stays
// mounted while closed so live state inside never resets mid-flow.

"use client";

import { useEffect, type ReactNode } from "react";

export function TermModal({
  open,
  onClose,
  title,
  locked = false,
  width = "max-w-md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** True mid-signing — backdrop/Escape/✕ disabled. */
  locked?: boolean;
  width?: string;
  children: ReactNode;
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
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open} inert={!open}>
      <div
        className={`backdrop-fade absolute inset-0 bg-black/70 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={locked ? undefined : onClose}
      />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`modal-pop w-full ${width} border border-edge2 bg-sheet shadow-2xl ${
            open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-dim">{title}</span>
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
          <div className="thin-scroll max-h-[78dvh] overflow-y-auto p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
