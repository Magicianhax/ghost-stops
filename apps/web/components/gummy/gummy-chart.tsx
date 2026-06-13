// components/gummy/gummy-chart.tsx — the full-bleed Money Gummy chart. A glowing
// themed price line (or chunky candles), with the big rounded price tag at the
// tip and entry / stop flags pinned to the right/left edges. Colors pull from
// the active theme's CSS vars so palette switches restyle it live.

"use client";

import { useEffect, useRef } from "react";

function cssVar(el: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function GummyChart({
  points,
  entryPrice = null,
  stopPrice = null,
  liqPrice = null,
  pnlSign = 0,
  style = "line",
}: {
  points: number[];
  entryPrice?: number | null;
  stopPrice?: number | null;
  liqPrice?: number | null;
  pnlSign?: 1 | -1 | 0;
  style?: "line" | "candles";
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tagRef = useRef<HTMLDivElement | null>(null);
  const entryRef = useRef<HTMLDivElement | null>(null);
  const stopRef = useRef<HTMLDivElement | null>(null);
  const liqRef = useRef<HTMLDivElement | null>(null);
  const state = useRef({ points, entryPrice, stopPrice, liqPrice, pnlSign, style });
  useEffect(() => { state.current = { points, entryPrice, stopPrice, liqPrice, pnlSign, style }; });

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.max(1, window.devicePixelRatio || 1);
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    };
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();

    const dispRef = { v: null as number | null };
    const TOP = 96, BOT = 150;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const s = state.current;
      const root = wrap.closest(".gs-terminal") as HTMLElement ?? wrap;
      const green = cssVar(root, "--green", "#5cf0a8");
      const red = cssVar(root, "--red", "#ff7b7b");
      const glow = cssVar(root, "--glow", "rgba(92,240,168,0.55)");
      const accent = cssVar(root, "--accent", "#ffe06b");
      const muted = cssVar(root, "--muted", "#82a895");

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const data = s.points, n = data.length;
      if (n < 2) return;
      const target = data[n - 1]!;
      dispRef.v = dispRef.v === null ? target : dispRef.v + (target - dispRef.v) * 0.16;
      const disp = dispRef.v;

      let min = disp, max = disp;
      for (let i = 0; i < n - 1; i++) { const v = data[i]!; if (v < min) min = v; if (v > max) max = v; }
      for (const extra of [s.entryPrice, s.stopPrice]) if (extra != null && Number.isFinite(extra)) { if (extra < min) min = extra; if (extra > max) max = extra; }
      const span = Math.max(max - min, Math.max(Math.abs(target) * 0.0007, 1e-9));
      const mid = (max + min) / 2; min = mid - span / 2; max = mid + span / 2;
      const pad = (max - min) * 0.18; min -= pad; max += pad;
      const plotH = Math.max(1, h - TOP - BOT);
      const Y = (v: number) => TOP + (1 - (v - min) / (max - min)) * plotH;
      const X = (i: number) => (i / (n - 1)) * w;
      const inPos = s.entryPrice != null && s.pnlSign !== 0;
      const line = inPos ? (s.pnlSign > 0 ? green : red) : green;

      // PnL band
      if (s.entryPrice != null && Number.isFinite(s.entryPrice) && inPos) {
        const ey = Y(s.entryPrice), cy = Y(disp);
        const g = ctx.createLinearGradient(0, cy, 0, ey);
        const c = s.pnlSign > 0 ? "92,240,168" : "255,123,123";
        g.addColorStop(0, `rgba(${c},0.16)`); g.addColorStop(1, `rgba(${c},0.01)`);
        ctx.fillStyle = g; ctx.fillRect(0, Math.min(cy, ey), w, Math.abs(cy - ey));
      }

      if (s.style === "candles") {
        const groups = 30, per = Math.max(1, Math.floor(n / groups));
        const bw = (w / Math.ceil(n / per)) * 0.62;
        let gi = 0;
        for (let i = 0; i < n; i += per) {
          const slice = data.slice(i, i + per);
          const o = slice[0]!, c = i + per >= n ? disp : slice[slice.length - 1]!;
          const hiV = Math.max(...slice), loV = Math.min(...slice);
          const x = (gi + 0.5) * (w / Math.ceil(n / per));
          const up = c >= o; ctx.fillStyle = up ? green : red; ctx.strokeStyle = up ? green : red; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x, Y(hiV)); ctx.lineTo(x, Y(loV)); ctx.stroke();
          const bodyTop = Y(Math.max(o, c)), bodyH = Math.max(3, Math.abs(Y(o) - Y(c)));
          ctx.beginPath(); (ctx as CanvasRenderingContext2D & { roundRect?: (x:number,y:number,w:number,h:number,r:number)=>void }).roundRect?.(x - bw / 2, bodyTop, bw, bodyH, 4);
          ctx.fill();
          gi++;
        }
      } else {
        ctx.strokeStyle = line; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.shadowColor = glow; ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const v = i === n - 1 ? disp : data[i]!; const x = X(i), y = Y(v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke(); ctx.shadowBlur = 0;
      }

      // stop dashed line
      if (s.stopPrice != null && Number.isFinite(s.stopPrice)) {
        ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.setLineDash([6, 7]); ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(0, Y(s.stopPrice)); ctx.lineTo(w, Y(s.stopPrice)); ctx.stroke(); ctx.setLineDash([]);
      }
      // entry dashed line
      if (s.entryPrice != null && Number.isFinite(s.entryPrice)) {
        ctx.strokeStyle = muted; ctx.lineWidth = 2; ctx.setLineDash([2, 8]); ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(0, Y(s.entryPrice)); ctx.lineTo(w, Y(s.entryPrice)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      // position the DOM flags
      const place = (el: HTMLDivElement | null, v: number | null) => { if (!el) return; if (v == null || !Number.isFinite(v)) { el.style.display = "none"; return; } el.style.display = ""; el.style.top = `${Y(v)}px`; };
      if (tagRef.current) { tagRef.current.style.top = `${Y(disp)}px`; tagRef.current.textContent = `$${disp.toFixed(2)}`; tagRef.current.className = `price-tag num${s.pnlSign < 0 && inPos ? " dn" : ""}`; }
      place(entryRef.current, s.entryPrice);
      place(stopRef.current, s.stopPrice);
      place(liqRef.current, s.liqPrice);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div ref={wrapRef} className="chart-layer">
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <div ref={tagRef} className="price-tag num" style={{ display: points.length < 2 ? "none" : undefined }}>$0.00</div>
      {entryPrice != null && <div ref={entryRef} className="entry-flag">entry</div>}
      {stopPrice != null && <div ref={stopRef} className="entry-flag stop-flag">stop</div>}
      {liqPrice != null && <div ref={liqRef} className="entry-flag liq-flag">liq</div>}
      {points.length < 2 && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <span className="num" style={{ color: "var(--faint)", fontWeight: 800, fontSize: 13 }}>connecting to Pyth Lazer…</span>
        </div>
      )}
    </div>
  );
}
