// ─────────────────────────────────────────────────────────────────────────────
// app/layout.tsx — root shell. Two distinctive faces load here: Chakra Petch
// (squared, cut-corner technical display — the "hard edges" in the type itself)
// for all chrome and labels, and IBM Plex Mono for every numeral. Cool
// near-black canvas, no rounded corners anywhere (enforced in globals).
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ghost Stops — on-chain trailing stops for Flash Trade",
  description:
    "The trailing stops Solana perps never had: trigger logic runs ON-CHAIN inside a MagicBlock Ephemeral Rollup (100ms crank, zero fees, live Pyth Lazer prices), executing real fills on Flash Trade V2 in ~1s via scoped session keys. Non-custodial.",
};

export const viewport: Viewport = {
  themeColor: "#08090c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${plexMono.variable}`}>
      <body className="min-h-[100dvh] bg-bg font-mono text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
