// ─────────────────────────────────────────────────────────────────────────────
// app/layout.tsx — root shell. The terminal uses Chakra Petch + IBM Plex Mono
// (hard-edged precision). The marketing landing uses its own "Money Gummy"
// faces — Baloo 2 (rounded display), Nunito (body), Space Mono (numerals) —
// scoped to the .gs-landing surface in landing.css.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Mono, Baloo_2, Nunito, Space_Mono } from "next/font/google";
import "./globals.css";

const chakra = Chakra_Petch({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-chakra", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-mono", display: "swap" });
const baloo = Baloo_2({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-baloo", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800", "900"], variable: "--font-nunito", display: "swap" });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-space-mono", display: "swap" });

const TITLE = "Ghost Stops — trailing stops that actually fire";
const DESCRIPTION =
  "Ghost Stops bolts trailing stops, OCO, and brackets onto Flash Trade perps. Your stop trails the price on-chain, evaluated ~10× a second inside a MagicBlock Ephemeral Rollup, and closes you out in about a second. No fees, non-custodial.";

// Resolve absolute URLs for OG/Twitter cards: explicit site URL → Vercel deploy
// URL → localhost. (opengraph-image.tsx is auto-wired as the card image.)
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Ghost Stops",
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: "Ghost Stops", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#08130d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${plexMono.variable} ${baloo.variable} ${nunito.variable} ${spaceMono.variable}`}>
      <body className="min-h-[100dvh] bg-bg font-mono text-ink antialiased">{children}</body>
    </html>
  );
}
