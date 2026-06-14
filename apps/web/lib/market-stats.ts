// lib/market-stats.ts — per-market quote data for the Markets dropdown:
//   • live price   → Flash's own /prices (one bulk call, matches the rest of the app)
//   • 24h change   → CoinGecko /coins/markets (real, free, no key)
//   • 7d sparkline → CoinGecko sparkline_in_7d (same call)
// Nothing is fabricated: crypto markets get change+spark; anything CoinGecko
// doesn't list (equities/FX/commodities) simply shows price only.
"use client";

import { useEffect, useState } from "react";
import { flash } from "./flash";

/** Flash symbol → CoinGecko id (crypto only; others stay price-only). */
const CG_IDS: Record<string, string> = {
  SOL: "solana", BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", XRP: "ripple",
  SUI: "sui", HYPE: "hyperliquid", NEAR: "near", ADA: "cardano", TRX: "tron",
  TON: "the-open-network", TAO: "bittensor", ZEC: "zcash", ONDO: "ondo-finance",
  DOGE: "dogecoin", WIF: "dogwifcoin", BONK: "bonk", JUP: "jupiter-exchange-solana",
  PUMP: "pump-fun", AVAX: "avalanche-2", LINK: "chainlink", LTC: "litecoin",
};

export interface MarketStat {
  priceUi: number | null;
  change24h: number | null;
  spark: number[] | null;
}

interface CgEntry { change24h: number; spark: number[] }
// module-level cache so reopening the dropdown doesn't refetch (CoinGecko free
// tier is rate-limited; 24h/7d data barely moves between opens).
let cgCache: { at: number; data: Record<string, CgEntry> } | null = null;

/** Live quote map (symbol → stat). Only fetches while `open` is true. */
export function useMarketStats(open: boolean): Record<string, MarketStat> {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [cg, setCg] = useState<Record<string, CgEntry>>(() => cgCache?.data ?? {});

  // Flash live prices — bulk, polled while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    let dead = false;
    const pull = async () => {
      try {
        const p = await flash.prices();
        if (dead) return;
        const m: Record<string, number> = {};
        for (const [k, v] of Object.entries(p)) m[k.toUpperCase()] = v.priceUi;
        setPrices(m);
      } catch { /* keep last; next tick retries */ }
    };
    void pull();
    const t = setInterval(() => void pull(), 5000);
    return () => { dead = true; clearInterval(t); };
  }, [open]);

  // CoinGecko 24h change + 7d sparkline — one call, cached 5 min.
  useEffect(() => {
    if (!open) return;
    if (cgCache && Date.now() - cgCache.at < 300_000) { setCg(cgCache.data); return; }
    let dead = false;
    void (async () => {
      try {
        const ids = [...new Set(Object.values(CG_IDS))].join(",");
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=24h`;
        const res = await fetch(url);
        if (!res.ok) return;
        const arr = (await res.json()) as Array<{ id: string; price_change_percentage_24h: number | null; sparkline_in_7d?: { price: number[] } }>;
        const idToSym: Record<string, string> = {};
        for (const [sym, id] of Object.entries(CG_IDS)) idToSym[id] = sym;
        const data: Record<string, CgEntry> = {};
        for (const c of arr) {
          const sym = idToSym[c.id];
          if (!sym) continue;
          const full = c.sparkline_in_7d?.price ?? [];
          data[sym] = { change24h: c.price_change_percentage_24h ?? 0, spark: full.length > 28 ? full.slice(-28) : full };
        }
        cgCache = { at: Date.now(), data };
        if (!dead) setCg(data);
      } catch { /* offline / rate-limited — rows just show price only */ }
    })();
    return () => { dead = true; };
  }, [open]);

  const out: Record<string, MarketStat> = {};
  for (const s of new Set([...Object.keys(prices), ...Object.keys(cg)])) {
    out[s] = { priceUi: prices[s] ?? null, change24h: cg[s]?.change24h ?? null, spark: cg[s]?.spark ?? null };
  }
  return out;
}
