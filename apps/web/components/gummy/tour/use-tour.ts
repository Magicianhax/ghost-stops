// components/gummy/tour/use-tour.ts — the guided-tour state machine: first-run
// trigger (once the trade ticket exists), persistence, keyboard nav, and the
// next/back/skip/start controls. All DOM work (resolve, measure, position) lives
// in <TourOverlay> so this stays a pure state hook.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOUR_STEPS, TOUR_DONE_KEY, type TourStep } from "./tour-steps";

export interface TourApi {
  active: boolean;
  index: number;
  total: number;
  step: TourStep | null;
  next: () => void;
  back: () => void;
  skip: () => void;
  start: () => void;
}

export function useTour(ready: boolean): TourApi {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const firedRef = useRef(false);
  const total = TOUR_STEPS.length;

  const finish = useCallback(() => {
    setActive(false);
    try { localStorage.setItem(TOUR_DONE_KEY, "1"); } catch { /* ignore */ }
  }, []);
  const start = useCallback(() => { setIndex(0); setActive(true); }, []);
  const next = useCallback(() => setIndex((i) => { if (i + 1 >= total) { finish(); return i; } return i + 1; }), [total, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // first-run: fire exactly once, the moment the user is genuinely set up and
  // sitting on a funded, ready-to-trade ticket. `ready` must exclude the brief
  // onboarding window where phase flickers to "flat" before the balance loads —
  // otherwise the tour pops up mid-setup. (Also, half the steps' targets only
  // exist once the trade ticket is rendered.)
  useEffect(() => {
    if (!ready || firedRef.current) return;
    let done = false;
    try { done = localStorage.getItem(TOUR_DONE_KEY) === "1"; } catch { /* treat as not-done */ }
    if (!done) { firedRef.current = true; setIndex(0); setActive(true); }
  }, [ready]);

  // keyboard: ← / → walk; Esc is handled by the page's global handler (gated on active)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, next, back]);

  return { active, index, total, step: active ? TOUR_STEPS[index] ?? null : null, next, back, skip: finish, start };
}
