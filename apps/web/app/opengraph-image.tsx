// app/opengraph-image.tsx — social preview card, rendered to PNG at build time.
// Money Gummy style: the ghost mascot, a live-looking chart line with the green
// price flag, and the pitch. Next auto-wires this into <meta og:image>/twitter.
import { ImageResponse } from "next/og";

export const alt = "Ghost Stops — trailing stops that actually fire on Flash Trade";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FONTS = "https://cdn.jsdelivr.net/fontsource/fonts";
// volatile-then-rising chart line, ending at the price flag on the right.
const LINE =
  "0,300 36,272 72,312 108,256 144,294 180,236 216,278 252,316 288,272 324,292 360,266 396,284 432,260 468,276 504,252 540,268 576,246 612,262 648,240 684,256 720,232 756,250 792,224 828,242 864,214 900,234 936,204 972,226 1008,196 1044,216 1090,190";

export default async function Image() {
  const [baloo, nunito] = await Promise.all([
    fetch(`${FONTS}/baloo-2@latest/latin-800-normal.ttf`).then((r) => r.arrayBuffer()),
    fetch(`${FONTS}/nunito@latest/latin-700-normal.ttf`).then((r) => r.arrayBuffer()),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", position: "relative", overflow: "hidden",
          padding: "62px 72px", color: "#eafff4", fontFamily: "Nunito",
          background: "radial-gradient(130% 110% at 28% -12%, #173d2b 0%, #0c1f17 55%, #08130d 100%)",
        }}
      >
        {/* chart line backdrop */}
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", top: 0, left: 0 }}>
          <polyline points={LINE} fill="none" stroke="#5cf0a8" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="1090" cy="190" r="7" fill="#5cf0a8" />
        </svg>

        {/* price flag, attached to the line tip */}
        <div style={{ position: "absolute", top: 152, right: 44, display: "flex", background: "#5cf0a8", color: "#08130d", border: "5px solid #06140d", borderRadius: 16, padding: "8px 20px", fontFamily: "Nunito", fontWeight: 700, fontSize: 40, boxShadow: "0 8px 0 #06140d" }}>
          $265.85
        </div>

        {/* brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width="104" height="104" viewBox="0 0 100 100">
            <path d="M18 52 a32 32 0 0 1 64 0 L82 86 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 Z" fill="#eafff4" stroke="#06140d" strokeWidth="5" strokeLinejoin="round" />
            <ellipse cx="40" cy="50" rx="5.5" ry="7" fill="#06140d" />
            <ellipse cx="60" cy="50" rx="5.5" ry="7" fill="#06140d" />
            <circle cx="31" cy="62" r="4.2" fill="#5cf0a8" opacity="0.7" />
            <circle cx="69" cy="62" r="4.2" fill="#5cf0a8" opacity="0.7" />
          </svg>
          <div style={{ display: "flex", fontFamily: "Baloo", fontWeight: 800, fontSize: 60 }}>Ghost Stops</div>
        </div>

        {/* pitch */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", fontFamily: "Baloo", fontWeight: 800, fontSize: 66, color: "#5cf0a8", lineHeight: 1 }}>
            Trailing stops that actually fire.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#a9d9c2", maxWidth: 900, lineHeight: 1.35 }}>
            On-chain trailing stops, OCO and brackets on Flash Trade perps - evaluated ~10x a second inside a MagicBlock Ephemeral Rollup. No fees, non-custodial.
          </div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 24, color: "#6fae90", fontWeight: 700 }}>
            Built on Flash Trade · MagicBlock · Solana
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Baloo", data: baloo, weight: 800, style: "normal" },
        { name: "Nunito", data: nunito, weight: 700, style: "normal" },
      ],
    },
  );
}
