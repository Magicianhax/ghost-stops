// components/terminal/term-chart.tsx — the price panel's canvas. A contained
// chart (not full-bleed): faint vertical hairline grid, a tip that lerps
// between polls so the line drifts instead of jumping, right-edge value axis, a
// flush price tag at the tip, and an entry line + PnL band when in a position.
// Colors pull from CSS tokens so it tracks the theme.

"use client";

import { useEffect, useRef } from "react";

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  const nice = unit >= 5 ? 10 : unit >= 2 ? 5 : unit >= 1 ? 2 : 1;
  return nice * pow;
}

export function TermChart({
  points,
  entryPrice = null,
  pnlSign = 0,
}: {
  points: number[];
  entryPrice?: number | null;
  pnlSign?: 1 | -1 | 0;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef<number[]>(points);
  const dispRef = useRef<number | null>(null);
  const posRef = useRef<{ entry: number | null; sign: 1 | -1 | 0 }>({ entry: entryPrice, sign: pnlSign });

  useEffect(() => { dataRef.current = points; }, [points]);
  useEffect(() => { posRef.current = { entry: entryPrice, sign: pnlSign }; }, [entryPrice, pnlSign]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const C = {
      bg: token("--color-bg", "#08090c"),
      grid: "#12151b",
      line: token("--color-long", "#2fe39b"),
      short: token("--color-short", "#ff4d62"),
      label: "#454b57",
      tagText: "#04130c",
    };

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.max(1, window.devicePixelRatio || 1);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const PAD_R = 60, PAD_Y = 18, TIP = 0.9;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);

      // vertical hairline grid (engineering-paper feel, faint)
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = w - PAD_R; gx > 0; gx -= 56) {
        ctx.moveTo(Math.round(gx) + 0.5, 0);
        ctx.lineTo(Math.round(gx) + 0.5, h);
      }
      ctx.stroke();

      const data = dataRef.current;
      const n = data.length;
      if (n < 2) return;

      const target = data[n - 1] ?? 0;
      const prev = dispRef.current;
      const disp = prev === null ? target : prev + (target - prev) * 0.16;
      dispRef.current = disp;

      const pos = posRef.current;
      let min = disp, max = disp;
      for (let i = 0; i < n - 1; i++) {
        const v = data[i] ?? disp;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (pos.entry !== null && Number.isFinite(pos.entry)) {
        if (pos.entry < min) min = pos.entry;
        if (pos.entry > max) max = pos.entry;
      }
      const span = Math.max(max - min, Math.max(Math.abs(target) * 0.0006, 1e-9));
      const mid = (max + min) / 2;
      min = mid - span / 2; max = mid + span / 2;

      const plotH = Math.max(1, h - PAD_Y * 2);
      const yOf = (v: number) => PAD_Y + (1 - (v - min) / (max - min)) * plotH;

      // value axis labels (right edge)
      const step = niceStep((span / plotH) * 44);
      const decimals = step >= 1 ? 2 : Math.min(6, Math.max(2, -Math.floor(Math.log10(step))));
      ctx.font = "500 10px var(--font-plex-mono), ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = C.label;
      for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
        const y = yOf(v);
        if (y < 10 || y > h - 10) continue;
        ctx.fillText(`$${v.toFixed(decimals)}`, w - 6, y);
      }

      const tipX = w * TIP - PAD_R * 0.2;
      const spacing = tipX / Math.max(1, n - 1);
      const xOf = (i: number) => tipX - (n - 1 - i) * spacing;

      const inPos = pos.entry !== null && Number.isFinite(pos.entry) && pos.sign !== 0;
      const lineColor = inPos ? (pos.sign > 0 ? C.line : C.short) : C.line;

      if (pos.entry !== null && Number.isFinite(pos.entry)) {
        const entryY = yOf(pos.entry);
        if (inPos && Math.abs(yOf(disp) - entryY) > 1.5) {
          const curY = yOf(disp);
          const grad = ctx.createLinearGradient(0, curY, 0, entryY);
          const c = pos.sign > 0 ? "47,227,155" : "255,77,98";
          grad.addColorStop(0, `rgba(${c},0.14)`);
          grad.addColorStop(1, `rgba(${c},0.01)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, Math.min(curY, entryY), w - PAD_R, Math.abs(curY - entryY));
        }
        ctx.save();
        ctx.strokeStyle = "rgba(136,142,156,0.5)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(0, entryY);
        ctx.lineTo(w - PAD_R, entryY);
        ctx.stroke();
        ctx.restore();
        ctx.font = "500 9px var(--font-plex-mono), ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(136,142,156,0.85)";
        ctx.fillText(`entry $${pos.entry.toFixed(decimals)}`, 6, entryY - 5);
      }

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = i === n - 1 ? disp : (data[i] ?? disp);
        const x = xOf(i);
        const y = yOf(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const tipY = yOf(disp);
      ctx.fillStyle = lineColor;
      ctx.fillRect(tipX - 1.5, tipY - 1.5, 3, 3);

      // flush price tag at the tip's Y
      const text = `$${disp.toFixed(2)}`;
      ctx.font = "600 11px var(--font-plex-mono), ui-monospace, monospace";
      const tw = ctx.measureText(text).width;
      const tagH = 18, tagW = tw + 14, tagX = w - tagW;
      const tagY = Math.min(Math.max(tipY - tagH / 2, 2), h - tagH - 2);
      ctx.fillStyle = lineColor;
      ctx.fillRect(tagX, tagY, tagW, tagH);
      ctx.fillStyle = C.tagText;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, tagX + tagW / 2, tagY + tagH / 2 + 0.5);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {points.length < 2 && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="soft-pulse font-mono text-[11px] text-faint">connecting to Pyth Lazer…</span>
        </div>
      )}
    </div>
  );
}
