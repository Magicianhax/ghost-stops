// components/terminal/panel.tsx — the terminal's structural unit. A bordered
// region with a hairline title bar (eyebrow label + optional right slot) and a
// body. Crop-marks are reserved for the live/active panels via `accent`.

import type { ReactNode } from "react";

export function Panel({
  title,
  right,
  accent = false,
  bodyClass = "",
  className = "",
  children,
}: {
  title: string;
  right?: ReactNode;
  /** Mint crop-marks + brighter title — for the panel currently doing work. */
  accent?: boolean;
  bodyClass?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col border border-edge bg-panel ${accent ? "framed framed-mint" : ""} ${className}`}
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-edge px-3">
        <span
          className={`font-display text-[10px] font-semibold uppercase tracking-[0.2em] ${
            accent ? "text-long" : "text-dim"
          }`}
        >
          {title}
        </span>
        {right}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}
