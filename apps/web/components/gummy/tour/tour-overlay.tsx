// components/gummy/tour/tour-overlay.tsx — the visual layer: a full-screen SVG
// scrim with a rounded "hole" spotlighting the current target (single <path>,
// fill-rule evenodd — clean rounded corners on the dark gummy backdrop), a
// transparent catcher that makes the tour modal (no accidental clicks reach the
// page), and an anchored popover with the copy + Back/Next/Skip + step counter.
// On narrow screens the popover becomes a centered bottom-sheet.
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TourApi } from "./use-tour";
import type { Placement } from "./tour-steps";

const PAD = 8;     // breathing room around the spotlit element
const RADIUS = 12; // matches --r-md
const GAP = 12;    // popover ↔ target

export function TourOverlay({ active, index, total, step, next, back, skip }: TourApi) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [pop, setPop] = useState<{ top: number; left: number } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);

  // resolve the (visible) target for the current step, measure it, and keep it
  // in sync with resize/scroll. If nothing visible resolves, skip the step.
  useLayoutEffect(() => {
    if (!active || !step) { setRect(null); return; }
    let dead = false, tries = 0, raf = 0;
    const find = (): HTMLElement | null => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(step.target));
      return els.find((el) => el.offsetParent !== null) ?? null; // visible match only
    };
    const sync = (el: HTMLElement) => { setRect(el.getBoundingClientRect()); setVp({ w: window.innerWidth, h: window.innerHeight }); };
    const measure = () => {
      if (dead) return;
      const el = find();
      if (!el) { if (tries++ < 8) { raf = requestAnimationFrame(measure); return; } next(); return; }
      el.scrollIntoView({ block: "center", inline: "center" });
      sync(el);
    };
    measure();
    const onMove = () => { const el = find(); if (el) sync(el); };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => { dead = true; cancelAnimationFrame(raf); window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); };
  }, [active, step, index, next]);

  // position the popover from the target rect + the popover's own size
  useLayoutEffect(() => {
    if (!rect || !popRef.current) { setPop(null); return; }
    const pw = popRef.current.offsetWidth, ph = popRef.current.offsetHeight;
    const W = window.innerWidth, H = window.innerHeight;
    if (W <= 560) { setPop({ top: H - ph - 16, left: Math.max(8, (W - pw) / 2) }); return; }
    const fits = (p: Placement): boolean =>
      p === "bottom" ? rect.bottom + GAP + ph <= H
      : p === "top" ? rect.top - GAP - ph >= 0
      : p === "right" ? rect.right + GAP + pw <= W
      : rect.left - GAP - pw >= 0;
    let place = step?.placement ?? "bottom";
    if (!fits(place)) place = (["bottom", "top", "right", "left"] as Placement[]).find(fits) ?? place;
    let top: number, left: number;
    if (place === "bottom") { top = rect.bottom + GAP; left = rect.left + rect.width / 2 - pw / 2; }
    else if (place === "top") { top = rect.top - GAP - ph; left = rect.left + rect.width / 2 - pw / 2; }
    else if (place === "right") { left = rect.right + GAP; top = rect.top + rect.height / 2 - ph / 2; }
    else { left = rect.left - GAP - pw; top = rect.top + rect.height / 2 - ph / 2; }
    setPop({ top: Math.max(8, Math.min(top, H - ph - 8)), left: Math.max(8, Math.min(left, W - pw - 8)) });
  }, [rect, step]);

  // pull focus to Next on each step (keyboard + a11y)
  useEffect(() => { if (active) nextRef.current?.focus(); }, [active, index]);

  if (!active || !step) return null;
  const W = vp.w || (typeof window !== "undefined" ? window.innerWidth : 0);
  const H = vp.h || (typeof window !== "undefined" ? window.innerHeight : 0);
  const d = `M0 0 H${W} V${H} H0 Z` + (rect ? roundedHole(rect.left - PAD, rect.top - PAD, rect.width + PAD * 2, rect.height + PAD * 2, RADIUS) : "");
  const last = index + 1 >= total;

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label={`Guided tour, step ${index + 1} of ${total}`}>
      <div className="tour-catch" />
      <svg className="tour-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <path d={d} fillRule="evenodd" className="tour-mask" />
        {rect && <rect x={rect.left - PAD} y={rect.top - PAD} width={rect.width + PAD * 2} height={rect.height + PAD * 2} rx={RADIUS} className="tour-ring" />}
      </svg>
      <div ref={popRef} className="tour-pop" style={pop ? { top: pop.top, left: pop.left } : { top: -9999, left: -9999 }}>
        <button className="tour-x" onClick={skip} aria-label="Skip tour">✕</button>
        <div className="tour-title disp">{step.title}</div>
        <div className="tour-body">{step.body}</div>
        <div className="tour-foot">
          <span className="tour-count num">Step {index + 1} of {total}</span>
          <div className="tour-btns">
            {index > 0 && <button className="tour-btn tour-back" onClick={back}>Back</button>}
            <button ref={nextRef} className="tour-btn tour-next" onClick={next}>{last ? "Finish" : "Next"}</button>
          </div>
        </div>
        <button className="tour-skip" onClick={skip}>Skip all</button>
      </div>
    </div>
  );
}

// a rounded-rect subpath; with the outer viewport rect + fill-rule:evenodd this
// punches a clean rounded hole regardless of winding direction.
function roundedHole(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r} ${y} h${w - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - 2 * r} a${r} ${r} 0 0 1 ${-r} ${r} h${-(w - 2 * r)} a${r} ${r} 0 0 1 ${-r} ${-r} v${-(h - 2 * r)} a${r} ${r} 0 0 1 ${r} ${-r} Z`;
}
