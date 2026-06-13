// components/token-logo.tsx — renders a market's REAL token logo from the
// vendored Flash token-icon set (public/token-icons), trying svg then png, and
// degrading to a letter chip if a symbol has no art. Used in both the terminal
// and the landing so neither shows a placeholder letter for a real token.

"use client";

import { useState } from "react";

// Extensions present in public/token-icons (svg for vector marks, png otherwise).
const SVG = new Set(["sol", "btc", "eth", "asts", "chip", "coin", "copper", "crcl", "intc", "lly", "mega", "mstr", "mu", "natgas", "ondo", "qcom", "sndk", "tao", "ton", "trx", "tsm", "txn", "xpd", "xpt"]);

function candidates(symbol: string): string[] {
  const s = symbol.toLowerCase();
  const first = SVG.has(s) ? `/token-icons/${s}.svg` : `/token-icons/${s}.png`;
  const second = SVG.has(s) ? `/token-icons/${s}.png` : `/token-icons/${s}.svg`;
  return [first, second];
}

export function TokenLogo({ symbol, size = 32, className = "", style }: { symbol: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const [idx, setIdx] = useState(0);
  const list = candidates(symbol);
  if (idx >= list.length) {
    return (
      <span className={className} style={{ ...style, width: size, height: size, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#9945FF,#14F195)", fontWeight: 900, fontSize: size * 0.42, color: "#10130a" }}>
        {symbol.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={list[idx]} alt={`${symbol} logo`} width={size} height={size} className={className} style={{ ...style, objectFit: "contain" }} onError={() => setIdx((i) => i + 1)} />
  );
}
