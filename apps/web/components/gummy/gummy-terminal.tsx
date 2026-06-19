// components/gummy/gummy-terminal.tsx — the Ghost Stops terminal in the "Money
// Gummy" aesthetic from the Claude Design handoff: a full-bleed themed chart
// under floating chunky chrome (topbar, expanding trade terminal, action zone,
// side drawers, centered modals, fire/execute notice). Real integration
// throughout — wallet, Flash V2 trades, on-chain Ghost Stops — reusing the
// existing data hooks and actions; only the presentation is new. Palette + chart
// style + density live in an in-app Settings modal, persisted to localStorage.

"use client";

import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type Adapter, type WalletError } from "@solana/wallet-adapter-base";
import { FlashV2Error, type PositionMetrics, type TradeType } from "flash-v2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ghost, Icon } from "@/components/gummy/ghost";
import { TokenLogo } from "@/components/token-logo";
import { GummyChart } from "@/components/gummy/gummy-chart";
import { OrderCard } from "@/components/gummy/order-card";
import { enableOneClickTrading, type EnableState, type EnableWalletCtx } from "@/lib/enable";
import { depositUsdc, executeWithdrawalStep, withdrawUsdc, type FundsStep } from "@/lib/funds";
import { COLLATERAL, flash, MARKETS } from "@/lib/flash";
import { computePositionView, explorerLink, FLASH_ER_RPC, fmtMs, fmtPnlUsd, num, shortKey } from "@/lib/format";
import { useBalances, useBasketBalance, useLatencyLog, useLivePrice, useMarketLimits, useMarkets, useOwner, useUsdcMint, type LatencyEntry } from "@/lib/hooks";
import { loadSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner } from "@/lib/signer";
import { usePriceHistory } from "@/lib/use-price-history";
import { cancelGhostOrder, clearAuthToken, createGhostOrder, ghostStopLevel, hasAuthToken, rawToUi, registerSessionWithExecutor, signInWithExecutor, useGhostMarkets, useGhostOrders } from "@/lib/ghost";
import { useMarketStats, type MarketStat } from "@/lib/market-stats";
import "@/app/terminal.css";

/** Tiny inline sparkline (7d) for the markets dropdown. */
function Spark({ points, up }: { points: number[]; up: boolean }) {
  if (!points || points.length < 2) return <span className="mr-spark mr-spark--empty" />;
  const w = 58, h = 22, min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className="mr-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--green)" : "var(--red)"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SIZE_DEFAULT = 25; // sensible starter stake (was "11")
const SIZE_PRESETS = ["10", "25", "50", "100"];
const TRAIL_PRESETS = [100, 200, 300, 500]; // bps · 1/2/3/5% · default 3% (a real stop, not a hair-trigger)

// Plain one-line explainers, shown inline when a "?" is tapped. Teaching the
// concepts beats relabeling them.
const GLOSSARY: Record<string, { title: string; body: string }> = {
  up: { title: "Bet it goes up (Long)", body: "You profit if the price rises, and lose if it falls. The amount you put in is the most you can lose." },
  down: { title: "Bet it goes down (Short)", body: "You profit if the price falls, and lose if it rises. The amount you put in is the most you can lose." },
  multiplier: { title: "Multiplier (leverage)", body: "2× means your gains and losses both count double. Higher multiplier = bigger swings and an easier wipe-out." },
  trail: { title: "Trailing stop", body: "Your safety net. It follows the price up and automatically sells if it drops this % from its highest point — so a winning trade can't turn into a big loss. You can turn it off." },
  liquidation: { title: "Liquidation", body: "If the price moves too far against you, the trade auto-closes and the money you put in is gone. A trailing stop usually closes you first." },
  loss: { title: "Most you can lose", body: "The most you can lose is the amount you put into this trade. You can't lose more, and you can never owe anything." },
};

const THEMES = ["gummy", "grape", "tangerine", "ice", "sticker"] as const;
const THEME_SW: Record<string, [string, string, string]> = {
  gummy: ["#0c1f17", "#5cf0a8", "#ffe06b"], grape: ["#15102b", "#b69bff", "#7af0d0"],
  tangerine: ["#2a1808", "#ffb454", "#7af0d0"], ice: ["#0a1e2c", "#5fd6ff", "#ffe06b"], sticker: ["#fef0dd", "#36c97f", "#ff9ec9"],
};

/** Format a UI dollar value (string or number) for the trade-details panel. */
function fmtPx(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : num(v ?? null);
  if (n == null || !Number.isFinite(n)) return "—";
  const dp = Math.abs(n) < 1 ? 4 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

// Flash (perpetuals) on-chain Anchor error codes → plain language.
const FLASH_ERRORS: Record<number, string> = {
  6019: "Not enough returned — try a smaller size or a little more slippage.",
  6020: "Price moved too fast for this order — try again.",
  6021: "Leverage too high for this market — lower the multiplier.",
  6022: "Leverage too high to open this trade — lower the multiplier and try again.",
  6023: "Leverage too low — raise the multiplier.",
  6024: "This market is at capacity right now — try a different one.",
  6025: "Position size limit reached for this market.",
  6026: "Pool balance is off right now — try again shortly.",
};

function errMsg(e: unknown): string {
  const raw = e instanceof FlashV2Error ? e.message : e instanceof Error ? e.message : String(e);
  // Not enough SOL for network rent/fees — the System Program reports the exact gap.
  const lamports = raw.match(/insufficient lamports\s+(\d+),\s*need\s+(\d+)/i);
  if (lamports) {
    const gap = (Number(lamports[2]) - Number(lamports[1])) / 1e9;
    const need = Math.max(0.01, Math.ceil((gap + 0.003) * 1000) / 1000);
    return `Almost there — your wallet needs ~${need.toFixed(3)} more SOL to cover network rent. Add a little SOL and try again. Your funds are safe.`;
  }
  // Decode Anchor custom on-chain errors (JSON "Custom": N, or raw "0x..hex") to
  // plain language instead of leaking the simulation log.
  const custom = raw.match(/"Custom":\s*(\d+)/);
  const hex = raw.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  const code = custom ? Number(custom[1]) : hex ? parseInt(hex[1]!, 16) : null;
  if (code !== null) {
    if (code === 6400) return "This wallet already has a Flash account — refresh the page and it'll use the existing one.";
    if (code === 0 || code === 1) return "Your wallet is a little short on SOL for this step — add ~0.01 SOL and try again.";
    return FLASH_ERRORS[code] ?? `The network rejected this (code ${code}) — nothing was charged. Try again.`;
  }
  if (/Failed to fetch|502/i.test(raw)) return "Can't reach the network right now; nothing was submitted. Try again.";
  if (/429|Too Many Requests/i.test(raw)) return "The network is busy — give it a moment and try again.";
  return raw;
}

export default function GummyTerminal() {
  // No explicit adapters: every modern Solana wallet (Phantom, Solflare,
  // Backpack, OKX, Zerion) self-registers via the Wallet Standard and is
  // discovered automatically. Passing explicit legacy adapters created a stale
  // duplicate whose connect path Phantom no longer supports (it connected then
  // immediately emitted WalletDisconnectedError).
  const wallets = useMemo<Adapter[]>(() => [], []);
  // Wallet-adapter logs EVERY wallet error to console.error by default — including
  // a user simply dismissing an approval popup. Declines are a normal outcome
  // (the flows that request signatures handle them and surface a friendly note),
  // so swallow them here; only genuinely unexpected wallet errors get logged.
  const onWalletError = useCallback((err: WalletError) => {
    if (/reject|declin|cancel|denied/i.test(`${err.name} ${err.message}`)) return;
    console.error("[wallet]", err.name, err.message);
  }, []);
  return (
    <ConnectionProvider endpoint={flash.network.baseRpc}>
      <WalletProvider wallets={wallets} autoConnect onError={onWalletError}>
        <Inner />
      </WalletProvider>
    </ConnectionProvider>
  );
}

type ModalId = "wallet" | "enable" | "funds" | "history" | "settings" | null;
type DrawerId = "stops" | "markets" | "risk" | null;

function Inner() {
  const walletCtx = useWallet();
  const anchorWallet = useAnchorWallet();
  const walletPk = walletCtx.publicKey?.toBase58() ?? null;

  // ── settings (palette / chart / density), persisted ─────────────────────────
  const [theme, setTheme] = useState("gummy");
  const [chartStyle, setChartStyle] = useState<"line" | "candles">("line");
  const [density, setDensity] = useState<"compact" | "regular" | "comfy">("regular");
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("gs-settings") || "{}");
      if (s.theme) setTheme(s.theme); if (s.chartStyle) setChartStyle(s.chartStyle); if (s.density) setDensity(s.density);
    } catch { /* defaults */ }
  }, []);
  useEffect(() => { try { localStorage.setItem("gs-settings", JSON.stringify({ theme, chartStyle, density })); } catch { /* ignore */ } }, [theme, chartStyle, density]);

  const [session, setSession] = useState<LoadedSession | null>(null);
  useEffect(() => { setSession(walletPk ? loadSession(walletPk) : null); }, [walletPk]);
  const signer = useMemo(() => {
    if (!anchorWallet || !session || session.authority !== anchorWallet.publicKey.toBase58()) return null;
    return makeSessionSigner(anchorWallet, session, flash.network);
  }, [anchorWallet, session]);

  const [market, setMarket] = useState(MARKETS[0] ?? "SOL");
  const liveMarkets = useMarkets();
  const markets = liveMarkets ?? MARKETS;
  useEffect(() => { if (liveMarkets && liveMarkets.length && !liveMarkets.includes(market)) setMarket(liveMarkets[0]!); }, [liveMarkets, market]);
  // restore the last-viewed token on load (URL ?m= wins, then localStorage) so a
  // refresh stays on the same coin instead of snapping back to the first market.
  useEffect(() => {
    try {
      const m = (new URLSearchParams(window.location.search).get("m") || localStorage.getItem("gs-market") || "").toUpperCase();
      if (m) setMarket(m);
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // keep the URL + localStorage in sync → every token has its own shareable link.
  useEffect(() => {
    try {
      localStorage.setItem("gs-market", market);
      const url = new URL(window.location.href);
      if (url.searchParams.get("m") !== market) { url.searchParams.set("m", market); window.history.replaceState(null, "", url.toString()); }
    } catch { /* ignore */ }
  }, [market]);
  // per-coin trade prefs: persist & restore Protect toggle, trail %, and leverage.
  const persistPref = useCallback((patch: { lev?: number; trailBps?: number; protectOn?: boolean }) => {
    try {
      const all = JSON.parse(localStorage.getItem("gs-prefs") || "{}");
      all[market] = { ...(all[market] || {}), ...patch };
      localStorage.setItem("gs-prefs", JSON.stringify(all));
    } catch { /* ignore */ }
  }, [market]);

  const { snapshot, status, refresh } = useOwner(walletPk);
  const usdcMint = useUsdcMint();
  const balances = useBalances(walletPk, usdcMint);
  const { markets: ghostMarkets, feeds: ghostFeeds } = useGhostMarkets();
  // real-time: feed-backed markets read the ER oracle over WS (the exact price
  // the on-chain stop watches); others fall back to fast Flash REST.
  const { price, drift } = useLivePrice(market, ghostFeeds[market.toUpperCase()] ?? null);
  const history = usePriceHistory(price, market);
  const { entries, add: addLog } = useLatencyLog();
  const limits = useMarketLimits(market);
  const { bal: basketBal, refresh: refreshBasket } = useBasketBalance(walletPk, snapshot?.basketPubkey ?? null, usdcMint);
  const ghostOrders = useGhostOrders(walletPk);
  const stopsSupported = useCallback((mkt: string | null | undefined) => Boolean(mkt) && ghostMarkets.includes(mkt!.toUpperCase()), [ghostMarkets]);

  const allPositions = useMemo<PositionMetrics[]>(() => Object.values(snapshot?.positionMetrics ?? {}), [snapshot]);
  const marketPositions = allPositions.filter((p) => p.marketSymbol.toUpperCase() === market.toUpperCase());
  const position = marketPositions[0] ?? null;
  const markUi = price?.priceUi ?? null;
  const marginInUse = allPositions.reduce((s, p) => s + (num(p.collateralUsdUi) ?? 0), 0);
  const basketExists = Boolean(snapshot?.basketPubkey);
  const enabled = basketExists && Boolean(signer);
  const freeUsd = basketBal ? Math.max(0, basketBal.inBasketUsd - marginInUse) : null;

  const basketData = snapshot?.basketData ?? null;
  useEffect(() => { if (basketData) { void balances.refresh(); void refreshBasket(); } }, [basketData, balances.refresh, refreshBasket]);

  const [modal, setModal] = useState<ModalId>(null);
  const [drawer, setDrawer] = useState<DrawerId>(null);
  const marketStats = useMarketStats(drawer === "markets");
  // markets dropdown is anchored under the pair pill (left:0); measure the pill so
  // the popover width can't overflow the viewport on narrow screens.
  const marketWrapRef = useRef<HTMLDivElement | null>(null);
  const [popMax, setPopMax] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (drawer !== "markets") return;
    const measure = () => {
      const r = marketWrapRef.current?.getBoundingClientRect();
      if (r) setPopMax(Math.max(280, Math.round(window.innerWidth - r.left - 12)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [drawer]);
  const [termOpen, setTermOpen] = useState(true);
  const [sizeUsd, setSizeUsd] = useState("");
  const [lev, setLev] = useState(2); // safe default multiplier (was 5×)
  const [busySide, setBusySide] = useState<TradeType | null>(null);
  const [busyPos, setBusyPos] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [armingStop, setArmingStop] = useState(false); // auto-arm after open
  const [protectOn, setProtectOn] = useState(true); // trailing stop default ON in the ticket
  const [trailBps, setTrailBps] = useState(300); // safe 3% default (was 0.5%)
  const [marketQuery, setMarketQuery] = useState("");
  const [stopHist, setStopHist] = useState<"all" | "executed" | "cancelled" | "failed">("all");
  const [registered, setRegistered] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableState, setEnableState] = useState<EnableState | null>(null);
  const [notice, setNotice] = useState<{ kind: "fire" | "good" | "bad"; title: string; sub: string } | null>(null);
  // pending one-tap confirm for irreversible actions (close / reverse)
  const [confirmAct, setConfirmAct] = useState<{ kind: "close" | "reverse"; label: string; run: () => void } | null>(null);
  const [glossary, setGlossary] = useState<string | null>(null); // tappable "?" explainer key

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);
  // restore per-coin Protect / trail % / leverage when the token changes
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("gs-prefs") || "{}")[market];
      if (p) {
        if (typeof p.lev === "number") setLev(p.lev);
        if (typeof p.trailBps === "number") setTrailBps(p.trailBps);
        if (typeof p.protectOn === "boolean") setProtectOn(p.protectOn);
      }
    } catch { /* ignore */ }
  }, [market]);
  // never let leverage exceed the market's cap (avoids the on-chain MaxInitLeverage
  // reject when a saved/stale multiplier is higher than this market allows).
  useEffect(() => {
    const max = limits?.maxLeverage;
    if (max && lev > max) setLev(Math.floor(max * 10) / 10);
  }, [limits?.maxLeverage, lev]);

  // live PnL mirror so trade-close notices can quote the realized number
  const livePnlRef = useRef<number | null>(null);
  // per-order: have we already announced "profit locked" (stop crossed entry)?
  const lockedRef = useRef<Record<string, boolean>>({});
  // orphan reconciliation: when did we first see an active stop with no matching
  // position, and which have we already auto-cancelled (cancel once).
  const orphanSince = useRef<Record<string, number>>({});
  const orphanHandled = useRef<Set<string>>(new Set());

  // fire/execute notice from order state transitions
  const prevStates = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const o of ghostOrders) {
      const prev = prevStates.current[o.pda];
      if (prev && prev !== o.state) {
        if (o.state === "fired") { if (typeof navigator !== "undefined") navigator.vibrate?.(15); setNotice({ kind: "fire", title: "Your trailing stop fired ⚡", sub: `${o.market} reversed past your stop — closing the trade to lock in your result.` }); }
        else if (o.state === "executed") setNotice({ kind: "good", title: "Protected exit ✓", sub: `Your ${o.market} trade was closed automatically by your trailing stop.` });
        else if (o.state === "failed") setNotice({ kind: "bad", title: "Stop couldn't close the trade", sub: "Your position is untouched — close it manually if you want out." });
      }
      prevStates.current[o.pda] = o.state;
    }
  }, [ghostOrders]);

  // milestone: a trailing stop ratchets past entry → it now LOCKS profit. Fire
  // once per order (the satisfying "you can't lose on this trade anymore" beat).
  useEffect(() => {
    for (const o of ghostOrders) {
      if (o.state !== "active" || o.kind !== "trailing" || lockedRef.current[o.pda]) continue;
      const pos = allPositions.find(
        (p) => p.marketSymbol.toUpperCase() === o.market.toUpperCase() && (p.sideUi.toUpperCase() === "LONG") === o.isLong,
      );
      const entry = pos ? num(pos.entryPriceUi) : null;
      if (entry == null) continue;
      const stopNow = rawToUi(ghostStopLevel(o));
      if (o.isLong ? stopNow >= entry : stopNow <= entry) {
        lockedRef.current[o.pda] = true;
        if (typeof navigator !== "undefined") navigator.vibrate?.(15);
        setNotice({ kind: "good", title: "Profit locked 🔒", sub: `${o.market} stop trailed ${o.isLong ? "above" : "below"} your entry $${entry.toFixed(2)} — this trade can't go red now.` });
      }
    }
  }, [ghostOrders, allPositions]);

  // sign-in on connect. If the user declines, we do NOT eject them back to zero
  // (that was hostile) — we just remember the decline and surface a gentle retry
  // affordance; nothing protected can happen until they prove ownership.
  const signingIn = useRef(false);
  const [signInDeclined, setSignInDeclined] = useState(false);
  const signedIn = walletPk ? hasAuthToken(walletPk) : false;
  const signMessage = walletCtx.signMessage;
  const doSignIn = useCallback(async () => {
    if (!walletPk || hasAuthToken(walletPk) || signingIn.current || !signMessage) return;
    signingIn.current = true;
    setSignInDeclined(false);
    try { await signInWithExecutor(walletPk, signMessage); }
    catch { clearAuthToken(); setSignInDeclined(true); }
    finally { signingIn.current = false; }
  }, [walletPk, signMessage]);
  useEffect(() => {
    if (!walletPk || signedIn || signInDeclined) return;
    void doSignIn();
  }, [walletPk, signedIn, signInDeclined, doSignIn]);

  useEffect(() => {
    setRegistered(false);
    if (!session || !signedIn) return; // /session needs a valid sign-in token
    let dead = false;
    let attempt = 0;
    const tryRegister = () => {
      registerSessionWithExecutor(session)
        .then(() => { if (!dead) setRegistered(true); })
        .catch(() => { // transient blip (executor restart / network) — back off and retry
          if (dead) return;
          attempt += 1;
          if (attempt < 4) setTimeout(tryRegister, 1500 * attempt);
          else setRegistered(false);
        });
    };
    tryRegister();
    return () => { dead = true; };
  }, [session?.token, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // safety net: a still-"active" stop with no matching open position is orphaned
  // (its trade was closed manually, on Flash, or liquidated). After a short grace
  // window — to avoid racing a freshly-armed stop or a transient snapshot gap —
  // auto-cancel it once so the Stops list reflects reality.
  useEffect(() => {
    if (!signedIn || !snapshot) return; // need a reliable position snapshot
    const now = Date.now();
    for (const o of ghostOrders) {
      if (o.state !== "active") continue;
      const hasPosition = allPositions.some(
        (p) => p.marketSymbol.toUpperCase() === o.market.toUpperCase() && (p.sideUi.toUpperCase() === "LONG") === o.isLong,
      );
      if (hasPosition) { delete orphanSince.current[o.pda]; orphanHandled.current.delete(o.pda); continue; }
      const since = orphanSince.current[o.pda] ?? (orphanSince.current[o.pda] = now);
      if (now - since > 15_000 && !orphanHandled.current.has(o.pda)) {
        orphanHandled.current.add(o.pda);
        void cancelGhostOrder(o.pda).catch(() => undefined);
      }
    }
  }, [ghostOrders, allPositions, signedIn, snapshot]);

  // keyboard: Escape closes any open surface. (Arrow-key trading was removed —
  // an invisible keybind that fired real leveraged market orders is a footgun.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setConfirmAct(null); setGlossary(null); setModal(null); setDrawer(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── actions ─────────────────────────────────────────────────────────────────
  // Open a position AND (if "Protect" is on and the market has a feed) arm the
  // trailing stop in the SAME action — the whole point of the product. The trade
  // itself never fails because the stop call lagged; we surface "arming…" instead.
  const openPosition = useCallback(async (side: TradeType) => {
    if (!signer || busySide) return;
    const amt = sizeUsd || String(SIZE_DEFAULT);
    const willProtect = protectOn && Boolean(walletPk) && stopsSupported(market);
    setBusySide(side);
    try {
      const q = await flash.openPosition({ inputTokenSymbol: COLLATERAL, outputTokenSymbol: market, inputAmountUi: amt, leverage: lev, tradeType: side, orderType: "MARKET", owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!q.transactionBase64) throw new Error("no transaction");
      const { signature, confirmMs } = await signer.sendTrade(q.transactionBase64);
      addLog({ action: `${side} ${lev}×`, chain: "er", ms: confirmMs, signature, trade: { market, side, entryUi: markUi, collateralUi: Number(amt) || null, pnlUi: null } });
      const dir = side === "LONG" ? "Up" : "Down";
      if (!willProtect) {
        setNotice({ kind: "good", title: `${dir} bet opened`, sub: `${market} · $${(Number(amt) || 0).toFixed(0)} · ${lev.toFixed(lev < 10 ? 1 : 0)}×${markUi ? ` @ $${markUi.toFixed(2)}` : ""}` });
      } else {
        setArmingStop(true);
        try {
          if (!registered && session) await registerSessionWithExecutor(session).then(() => setRegistered(true)).catch(() => undefined);
          await createGhostOrder({ owner: walletPk!, market, kind: "trailing", trailingBps: trailBps, sizePctBps: 10000, isLong: side === "LONG" });
          if (typeof navigator !== "undefined") navigator.vibrate?.(15);
          setNotice({ kind: "fire", title: `${dir} bet opened & protected ⚡`, sub: `${market} · sells if it falls ${(trailBps / 100).toFixed(trailBps < 100 ? 1 : 0)}% from its peak · watching live` });
        } catch (e) {
          setNotice({ kind: "good", title: `${dir} bet opened`, sub: `${market} · couldn't arm the stop — tap “Protect this trade” to retry.` });
          setToast(`Trade opened, but arming protection failed: ${errMsg(e)}`);
        } finally { setArmingStop(false); }
      }
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusySide(null); }
  }, [signer, busySide, sizeUsd, lev, market, markUi, addLog, protectOn, walletPk, stopsSupported, trailBps, registered, session]);

  const closePosition = useCallback(async (mkt: string, side: TradeType) => {
    if (!signer) return;
    setBusyPos(true);
    try {
      const c = await flash.closePosition({ marketSymbol: mkt, side, inputUsdUi: "0", withdrawTokenSymbol: COLLATERAL, owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!c.transactionBase64) throw new Error("no transaction");
      const { signature, confirmMs } = await signer.sendTrade(c.transactionBase64);
      addLog({ action: `CLOSE ${side}`, chain: "er", ms: confirmMs, signature, trade: { market: mkt, side, entryUi: null, collateralUi: null, pnlUi: null } });
      // the position is gone — cancel its trailing stop so it doesn't dangle
      for (const o of ghostOrders) {
        if (o.state === "active" && o.market.toUpperCase() === mkt.toUpperCase() && o.isLong === (side === "LONG")) void cancelGhostOrder(o.pda).catch(() => undefined);
      }
      const pnl = livePnlRef.current;
      setNotice({ kind: pnl != null && pnl < 0 ? "bad" : "good", title: pnl != null && pnl < 0 ? "Trade closed" : "Trade closed — nice", sub: `${mkt}${pnl != null ? ` · ${pnl >= 0 ? "you made" : "you lost"} $${Math.abs(pnl).toFixed(2)}` : ""}` });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusyPos(false); }
  }, [signer, addLog, ghostOrders]);

  const reversePosition = useCallback(async (mkt: string, side: TradeType) => {
    if (!signer) return;
    setBusyPos(true);
    const newSide: TradeType = side === "LONG" ? "SHORT" : "LONG";
    try {
      const b = await flash.reversePosition({ marketSymbol: mkt, side, leverage: lev, owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!b.transactionBase64) throw new Error("no transaction");
      const { signature, confirmMs } = await signer.sendTrade(b.transactionBase64);
      addLog({ action: `REVERSE → ${newSide}`, chain: "er", ms: confirmMs, signature, trade: { market: mkt, side: newSide, entryUi: markUi, collateralUi: null, pnlUi: null } });
      // the old-side position is gone — cancel its stop (the user can arm a new one for the flipped side)
      for (const o of ghostOrders) {
        if (o.state === "active" && o.market.toUpperCase() === mkt.toUpperCase() && o.isLong === (side === "LONG")) void cancelGhostOrder(o.pda).catch(() => undefined);
      }
      setNotice({ kind: "good", title: `Flipped to ${newSide === "LONG" ? "Up" : "Down"}`, sub: `${mkt}${markUi ? ` @ $${markUi.toFixed(2)}` : ""}` });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusyPos(false); }
  }, [signer, lev, markUi, addLog, ghostOrders]);

  const runEnable = useCallback(async () => {
    if (enabling) return;
    const pk = walletCtx.publicKey, st = walletCtx.signTransaction;
    if (!pk || !anchorWallet || !st) { setModal("wallet"); return; }
    setEnabling(true); setModal("enable");
    try {
      const res = await enableOneClickTrading({ wallet: { publicKey: pk, signTransaction: st, signAllTransactions: walletCtx.signAllTransactions }, anchorWallet, snapshot, usdcMint, balances: { sol: balances.sol, usdc: balances.usdc }, onStep: setEnableState, onLog: addLog });
      if (res.session) setSession(res.session);
      await refresh(); void balances.refresh();
    } catch (e) { setToast(errMsg(e)); }
    finally { setEnabling(false); }
  }, [enabling, walletCtx, anchorWallet, snapshot, usdcMint, balances, addLog, refresh]);

  const attachStop = useCallback(async () => {
    if (!walletPk || !position || attaching) return;
    if (!stopsSupported(position.marketSymbol)) {
      setToast(`Ghost Stops protects ${ghostMarkets.join(", ")} today — ${position.marketSymbol} has no verified oracle feed yet.`);
      return;
    }
    setAttaching(true);
    try {
      await createGhostOrder({ owner: walletPk, market: position.marketSymbol, kind: "trailing", trailingBps: trailBps, sizePctBps: 10000, isLong: position.sideUi.toUpperCase() === "LONG" });
      if (typeof navigator !== "undefined") navigator.vibrate?.(15);
      setNotice({ kind: "fire", title: "Protected ⚡", sub: `${position.marketSymbol} · sells if it falls ${(trailBps / 100).toFixed(trailBps < 100 ? 1 : 0)}% from its peak · watching live, ~10× a second` });
      setDrawer("stops");
    } catch (e) { setToast(errMsg(e)); }
    finally { setAttaching(false); }
  }, [walletPk, position, attaching, trailBps, stopsSupported, ghostMarkets]);

  const cancelStop = useCallback((pda: string) => { void cancelGhostOrder(pda).catch((e) => setToast(errMsg(e))); }, []);
  /** Jump to a token from a list (stop card, risk list) and close the drawer. */
  const openMarket = useCallback((m: string) => { setMarket(m.toUpperCase()); setDrawer(null); }, []);
  // user-driven trade-pref changes also save per-coin (restored on return).
  const chooseLev = useCallback((v: number) => { setLev(v); persistPref({ lev: v }); }, [persistPref]);
  const chooseTrail = useCallback((v: number) => { setTrailBps(v); persistPref({ trailBps: v }); }, [persistPref]);
  const toggleProtect = useCallback(() => setProtectOn((on) => { persistPref({ protectOn: !on }); return !on; }), [persistPref]);

  // ── derived view state ──────────────────────────────────────────────────────
  const posView = position ? computePositionView(position, markUi) : null;
  const posSide: TradeType = position?.sideUi.toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  // Flash's pre-enriched leverageUi/liquidationPriceUi are unreliable (often
  // "Infinity"/degenerate). Derive them from the trustworthy size/collateral/entry:
  //   leverage = notional / margin ; liq ≈ break-even (entry shifted by 1/leverage).
  const posLev = (() => { const sz = num(position?.sizeUsdUi), col = num(position?.collateralUsdUi); return sz != null && col != null && col > 0 ? sz / col : null; })();
  const liqUi = (() => { if (!position || posLev == null || posLev <= 0) return null; const entry = num(position.entryPriceUi); return entry == null ? null : posSide === "LONG" ? entry * (1 - 1 / posLev) : entry * (1 + 1 / posLev); })();
  const activeStops = ghostOrders.filter((o) => o.state === "active");
  const protectedNow = activeStops.some((o) => position && o.market === position.marketSymbol && o.isLong === (posSide === "LONG"));
  // open positions (any market) with NO active trailing stop — the "at risk" set.
  const unprotectedPositions = allPositions.filter((p) =>
    !activeStops.some((o) => o.market.toUpperCase() === p.marketSymbol.toUpperCase() && o.isLong === (p.sideUi.toUpperCase() === "LONG")));
  const live = walletPk ? status === "open" : price !== null;
  const connClass = !live ? "off" : status === "polling" ? "poll" : "";
  const lastErMs = entries.find((e) => e.chain === "er")?.ms ?? null;
  const priceTxt = price ? price.priceUi.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  const enableWallet: EnableWalletCtx | null = walletCtx.publicKey && walletCtx.signTransaction ? { publicKey: walletCtx.publicKey, signTransaction: walletCtx.signTransaction, signAllTransactions: walletCtx.signAllTransactions } : null;
  const phase = !walletPk ? "connect" : !signedIn ? "signin" : !enabled ? "enable" : (basketBal !== null && basketBal.inBasketUsd < 0.01) ? "deposit" : position ? "position" : "flat";
  const activeStop = activeStops.find((o) => position && o.market === position.marketSymbol);
  const stopUi = activeStop ? rawToUi(ghostStopLevel(activeStop)) : null;
  const sizeNum = Number(sizeUsd) || SIZE_DEFAULT;
  const marketProtectable = stopsSupported(market);
  // approx auto-close move from the multiplier (isolated margin wipes near 1/lev)
  const liqMovePct = lev > 0 ? Math.round((100 / lev) * 0.9) : 0;
  // SAFETY: a trailing stop only protects if it fires BEFORE liquidation. The stop
  // sits ~trail% from peak; liq sits ~(1/lev) from entry. If trail ≥ liq distance,
  // you'd be liquidated first and the stop is useless. Warn pre-trade + on-position.
  const liqAwayPct = lev > 0 ? (100 / lev) * 0.9 : 100;
  const stopBelowLiq = marketProtectable && protectOn && (trailBps / 100) >= liqAwayPct;
  const maxSafeTrailPct = Math.max(0.1, Math.floor(liqAwayPct * 0.8 * 10) / 10);
  // for an OPEN position: is the live stop already on the wrong side of liq?
  const stopUnsafe = activeStop != null && liqUi != null && stopUi != null && (posSide === "LONG" ? stopUi <= liqUi : stopUi >= liqUi);

  return (
    <div className="gs-terminal app" data-theme={theme} data-density={density === "regular" ? undefined : density} data-phase={phase}>
      <GummyChart points={history} entryPrice={position ? num(position.entryPriceUi) : null} stopPrice={stopUi} liqPrice={liqUi} pnlSign={posView ? (posView.pnlUsd >= 0 ? 1 : -1) : 0} isLong={position ? posSide === "LONG" : null} style={chartStyle} />

      <div className="hud">
        {/* ── top bar ── */}
        <div className={`topbar${drawer === "markets" ? " topbar--pop" : ""}`}>
          <a className="seg seg--brand" href="/" title="Back to home"><Ghost size={36} float /><span className="brand-name disp">Ghost Stops</span></a>
          <div className="seg--market-wrap" ref={marketWrapRef}>
            <button className="seg seg--market" onClick={() => setDrawer(drawer === "markets" ? null : "markets")}>
              <span className="tk" style={{ background: "var(--panel-2)", overflow: "hidden", padding: 0 }}><TokenLogo symbol={market} size={28} /></span>
              <span className="market-meta"><span className="pair">{market}-PERP</span><span className={`pair-px num ${drift === "down" ? "dn" : ""}`}>{priceTxt} {drift === "down" ? "▼" : "▲"}</span></span>
              <span className="caret">▾</span>
            </button>
            {drawer === "markets" && (
              <>
                <div className="pop-catch" onClick={() => { setDrawer(null); setMarketQuery(""); }} />
                <div className="market-pop" style={popMax ? { maxWidth: popMax } : undefined}>
                  <label className="market-search">
                    <Icon name="search" size={18} />
                    <input value={marketQuery} onChange={(e) => setMarketQuery(e.target.value)} placeholder="Search markets…" autoFocus />
                    {marketQuery && <button onClick={() => setMarketQuery("")} aria-label="Clear" style={{ color: "var(--muted)", display: "grid" }}><Icon name="x" size={16} /></button>}
                  </label>
                  {(() => {
                    const q = marketQuery.trim().toLowerCase();
                    const filtered = q ? markets.filter((m) => m.toLowerCase().includes(q)) : markets;
                    if (filtered.length === 0) return <div className="empty" style={{ padding: "24px 8px" }}><Ghost size={48} className="em-ghost" /><div className="em-title disp">No match</div><div className="em-sub">No market matches &ldquo;{marketQuery}&rdquo;.</div></div>;
                    const withStops = filtered.filter((m) => stopsSupported(m));
                    const without = filtered.filter((m) => !stopsSupported(m));
                    const row = (m: string) => {
                      const st: MarketStat | undefined = marketStats[m.toUpperCase()];
                      const px = st?.priceUi ?? null;
                      const chg = st?.change24h ?? null;
                      const up = (chg ?? 0) >= 0;
                      const pxTxt = px == null ? "—" : `$${px.toLocaleString("en-US", { minimumFractionDigits: px < 1 ? 4 : 2, maximumFractionDigits: px < 1 ? 4 : 2 })}`;
                      return (
                        <button key={m} className={`market-row ${m === market ? "on" : ""}`} onClick={() => { setMarket(m); setDrawer(null); setMarketQuery(""); }}>
                          <span className="tk" style={{ background: "var(--panel-2)", overflow: "hidden", padding: 0, width: 30, height: 30 }}><TokenLogo symbol={m} size={28} /></span>
                          <span className="mr-id">
                            <div className="mr-name">{m}-PERP {stopsSupported(m) && <Icon name="pulse" size={11} className="mr-prot" />}</div>
                            <div className="mr-sym">{m}/USDC{m === market ? " · active" : ""}</div>
                          </span>
                          <Spark points={st?.spark ?? []} up={up} />
                          <span className="mr-quote">
                            <span className="mr-price num">{pxTxt}</span>
                            <span className={`mr-chg num ${chg == null ? "flat" : up ? "up" : "dn"}`}>{chg == null ? "" : `${up ? "+" : ""}${chg.toFixed(2)}%`}</span>
                          </span>
                        </button>
                      );
                    };
                    return (
                      <>
                        {withStops.length > 0 && <div className="section-label">Ghost Stops available</div>}
                        {withStops.map(row)}
                        {without.length > 0 && <div className="section-label">Trade-only (no stops yet)</div>}
                        {without.map(row)}
                      </>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
          <div className="spacer" />
          <button className="seg seg-btn" onClick={() => setDrawer("stops")}><Icon name="pulse" className="gi" /><span className="seg-label">Stops</span>{activeStops.length > 0 && <span className="badge live">{activeStops.length}</span>}</button>
          {unprotectedPositions.length > 0 && (
            <button className="seg seg--risk" onClick={() => setDrawer("risk")} title="Open trades with no stop"><Icon name="alert" size={16} /><span className="seg-label">{unprotectedPositions.length} unprotected</span></button>
          )}
          {position ? (
            protectedNow ? (
              <button className="seg seg--prot ok" onClick={() => setDrawer("stops")} title="This trade is protected"><Icon name="pulse" size={14} /><span className="seg-label">protected{stopUi ? ` · $${stopUi.toFixed(2)}` : ""}</span></button>
            ) : (
              <button className="seg seg--prot warn" onClick={() => marketProtectable ? void attachStop() : setDrawer("stops")} title="This trade has no safety net"><Icon name="pulse" size={14} /><span className="seg-label">unprotected</span></button>
            )
          ) : (
            <button className="seg seg--lat" onClick={() => setModal("history")} title="Live ER confirm time"><span className={`conn-dot ${connClass}`} /><span className="lat-text">{lastErMs === null ? "live" : <b>{fmtMs(lastErMs)}</b>}</span></button>
          )}
          {walletPk ? (
            <button className="seg seg--wallet" onClick={() => setModal("history")}>
              <span className="market-meta"><span className="bal num">${(basketBal?.inBasketUsd ?? 0).toFixed(2)}</span><span className="bal-sub">ready to trade</span></span>
              <span className="av" />
            </button>
          ) : (
            <button className="seg seg--connect"><span className="btn btn--accent" onClick={() => setModal("wallet")} style={{ boxShadow: "none", border: "none" }}>Connect</span></button>
          )}
          <button className="seg seg--icon" onClick={() => setModal("settings")} title="Settings"><Icon name="gear" size={20} /></button>
        </div>

        {/* ── trade terminal (bottom-left; centered modal on mobile) ── */}
        {(phase === "flat" || phase === "position") && (
          <>
            {phase === "flat" && termOpen && <div className="term-scrim" onClick={() => setTermOpen(false)} />}
            <div className={`terminal${termOpen ? "" : " terminal--collapsed"}`}>
            {!termOpen ? (
              <div className="term-collapsed" onClick={() => setTermOpen(true)}>
                <div className="term-sum"><div><div className="k">size</div><div className="v num">${sizeUsd || "—"}</div></div><div><div className="k">lev</div><div className="v num">{lev}×</div></div></div>
                <span className="term-open-cta">edit ▸</span>
              </div>
            ) : (
              <div className="term-body">
                <div className="term-head"><span className="term-title disp">Trade {market}</span><button className="term-x" onClick={() => setTermOpen(false)}>–</button></div>
                <div className="field-cap"><span>amount</span><button onClick={() => freeUsd && setSizeUsd(String(Math.floor(freeUsd * 100) / 100))} className="muted" style={{ background: "none" }}>free ${(freeUsd ?? 0).toFixed(2)}</button></div>
                <div className="amount-wrap"><span className="amount-cur">$</span><input className="amount-input" value={sizeUsd} onChange={(e) => setSizeUsd(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))} placeholder={String(SIZE_DEFAULT)} inputMode="decimal" /></div>
                <div className="preset-row">{SIZE_PRESETS.map((p) => <button key={p} className={`preset ${sizeUsd === p ? "on" : ""}`} onClick={() => setSizeUsd(p)}>${p}</button>)}</div>

                {/* trailing-stop — the hero, baked into the ticket */}
                <div className={`protect ${protectOn && marketProtectable ? "on" : ""}`}>
                  <div className="protect-head">
                    <span className="protect-title"><Icon name="pulse" size={15} /> Protect with a trailing stop <button className="qmark" onClick={() => setGlossary("trail")} aria-label="What is a trailing stop?">?</button></span>
                    <button className={`switch ${protectOn ? "on" : ""}`} disabled={!marketProtectable} onClick={toggleProtect} aria-pressed={protectOn}><span className="knob" /></button>
                  </div>
                  {marketProtectable ? (
                    protectOn && (
                      <>
                        <div className="trail-presets">
                          {TRAIL_PRESETS.map((b) => <button key={b} className={`chip ${trailBps === b ? "on" : ""}`} onClick={() => chooseTrail(b)}>{(b / 100).toFixed(b < 100 ? 1 : 0)}%</button>)}
                        </div>
                        <label className={`trail-custom-row ${!TRAIL_PRESETS.includes(trailBps) ? "on" : ""}`} title="Set any trail %">
                          <span className="trail-custom-lbl">Custom trail</span>
                          <span className="trail-custom-box"><input type="number" min={0.1} max={50} step={0.1} placeholder="0.0" value={TRAIL_PRESETS.includes(trailBps) ? "" : trailBps / 100} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) chooseTrail(Math.max(10, Math.min(5000, Math.round(v * 100)))); }} /><b>%</b></span>
                        </label>
                        <div className="protect-note">Sells if {market} falls <b>{(trailBps / 100).toFixed(trailBps < 100 ? 1 : 0)}%</b> from its peak — so a win can&apos;t turn into a big loss.</div>
                        {stopBelowLiq && <div className="liq-warn">⚠ At <b>{lev.toFixed(lev < 10 ? 1 : 0)}×</b> your {(trailBps / 100).toFixed(trailBps < 100 ? 1 : 0)}% stop sits <b>past liquidation</b> (~{liqAwayPct.toFixed(1)}%) — you&apos;d be liquidated first, so it can&apos;t protect you. Use <b>≤{maxSafeTrailPct}%</b> or lower the multiplier.</div>}
                      </>
                    )
                  ) : (
                    <div className="protect-note">Trailing stops cover {ghostMarkets.slice(0, 4).join(", ")}{ghostMarkets.length > 4 ? "…" : ""}. Switch to one of those to protect this trade.</div>
                  )}
                </div>

                <div className="lev-block">
                  <div className="field-cap"><span>multiplier <button className="qmark" onClick={() => setGlossary("multiplier")} aria-label="What is the multiplier?">?</button></span><span className="lev-val num">{lev.toFixed(lev < 10 ? 1 : 0)}×</span></div>
                  <input type="range" className="gummy-range" min={limits?.minLeverage ?? 1.1} max={limits?.maxLeverage ?? 100} step={0.1} value={lev} onChange={(e) => chooseLev(Number(e.target.value))} />
                  <div className="lev-chips">{[2, 5, 10, 20].filter((c) => c <= (limits?.maxLeverage ?? 100)).map((c) => <button key={c} className={`chip ${Math.round(lev) === c ? "on" : ""}`} onClick={() => chooseLev(c)}>{c}×</button>)}</div>
                  {lev > 10 && <div className="risk-warn">High multiplier — a {liqMovePct}% move against you wipes this trade.</div>}
                </div>

                <div className="risk-line">
                  <span>If {market} drops ~{liqMovePct}% it auto-closes <button className="qmark" onClick={() => setGlossary("liquidation")} aria-label="What is liquidation?">?</button></span>
                  <b className="num">most you can lose: ${sizeNum.toFixed(0)}</b>
                </div>
                {phase === "flat" && (
                  <div className="term-trade-mobile">
                    <button className={`act act--short ${busySide === "SHORT" ? "flash-on" : ""}`} onClick={() => void openPosition("SHORT")} disabled={busySide !== null}><span className="big disp">{busySide === "SHORT" ? (armingStop ? "Protecting…" : "Opening…") : <>{protectOn && marketProtectable && <span className="bet-shield">🛡</span>}Down <Icon name="down" size={18} /></>}</span></button>
                    <button className={`act act--long ${busySide === "LONG" ? "flash-on" : ""}`} onClick={() => void openPosition("LONG")} disabled={busySide !== null}><span className="big disp">{busySide === "LONG" ? (armingStop ? "Protecting…" : "Opening…") : <>{protectOn && marketProtectable && <span className="bet-shield">🛡</span>}Up <Icon name="up" size={18} /></>}</span></button>
                  </div>
                )}
              </div>
            )}
            </div>
          </>
        )}

        {/* ── onboarding progress (only while setting up) ── */}
        {(phase === "connect" || phase === "signin" || phase === "enable" || phase === "deposit") && (() => {
          const step = phase === "connect" ? 0 : phase === "signin" || phase === "enable" ? 1 : 2;
          return (
            <div className="onboard">
              {["Connect", "Set up", "Add USDC", "Trade"].map((label, i) => (
                <div key={label} className={`ob-step ${i < step ? "done" : i === step ? "now" : ""}`}>
                  <span className="ob-dot">{i < step ? "✓" : i + 1}</span><span className="ob-label">{label}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── action zone ── */}
        <div className="actionzone actionzone--cluster">
          {phase === "connect" && <button className="act act--connect act--cta" onClick={() => setModal("wallet")}><span className="act-cta-big disp">Start trading</span></button>}
          {phase === "signin" && <button className="act act--enable act--cta" onClick={() => void doSignIn()} disabled={!signInDeclined}><span className="act-cta-big disp">{signInDeclined ? "Prove your wallet (free)" : "Proving your wallet…"}</span></button>}
          {phase === "enable" && <button className="act act--enable act--cta" onClick={() => void runEnable()} disabled={enabling}><span className="act-cta-big disp">{enabling ? "Setting up…" : "Set up your account"}</span></button>}
          {phase === "deposit" && <button className="act act--deposit act--cta" onClick={() => setModal("funds")}><span className="act-cta-big disp">Add USDC to start</span></button>}
          {phase === "flat" && (
            <>
              <button className={`act act--short act--compact ${busySide === "SHORT" ? "flash-on" : ""}`} onClick={() => void openPosition("SHORT")} disabled={busySide !== null}><span className="big disp">{busySide === "SHORT" ? (armingStop ? "Protecting…" : "Opening…") : <>{protectOn && marketProtectable && <span className="bet-shield">🛡</span>}Down <Icon name="down" size={18} /></>}</span></button>
              <button className="act act--mid act--mid-stops" onClick={() => setDrawer("stops")}><Icon name="pulse" size={18} /> Stops{activeStops.length > 0 ? ` · ${activeStops.length}` : ""}</button>
              <button className={`act act--long act--compact ${busySide === "LONG" ? "flash-on" : ""}`} onClick={() => void openPosition("LONG")} disabled={busySide !== null}><span className="big disp">{busySide === "LONG" ? (armingStop ? "Protecting…" : "Opening…") : <>{protectOn && marketProtectable && <span className="bet-shield">🛡</span>}Up <Icon name="up" size={18} /></>}</span></button>
            </>
          )}
          {phase === "position" && position && (
            <>
              {!protectedNow && marketProtectable && (
                <button className="act act--protect" onClick={() => void attachStop()} disabled={attaching}><span className="act-cta-big disp"><Icon name="pulse" size={18} /> {attaching ? "Protecting…" : "Protect this trade"}</span></button>
              )}
              <button className="act act--reverse" onClick={() => setConfirmAct({ kind: "reverse", label: `Flip your ${position.marketSymbol} ${posSide === "LONG" ? "Up" : "Down"} bet to ${posSide === "LONG" ? "Down" : "Up"}?`, run: () => void reversePosition(position.marketSymbol, posSide) })} disabled={busyPos} title="Flip direction"><Icon name="swap" size={16} /> Reverse</button>
              <button className={`act act--close ${(posView?.pnlUsd ?? 0) < 0 ? "neg" : ""}`} onClick={() => setConfirmAct({ kind: "close", label: posView ? (posView.pnlUsd >= 0 ? `Close and take your $${posView.pnlUsd.toFixed(2)}?` : `Close this trade and take the $${Math.abs(posView.pnlUsd).toFixed(2)} loss?`) : "Close this trade?", run: () => void closePosition(position.marketSymbol, posSide) })} disabled={busyPos}>
                <span className="act-side" style={{ alignItems: "flex-start" }}><span className="act-k">{busyPos ? "closing…" : "tap to close"}</span><span className="big disp">{position.marketSymbol} {posSide === "LONG" ? "Up" : "Down"}</span></span>
                <span className="act-pnl num"><span>{posView ? fmtPnlUsd(posView.pnlUsd) : "—"}</span>{posView && <span className="act-pnl-pct">{posView.pnlPct >= 0 ? "+" : "−"}{Math.abs(posView.pnlPct).toFixed(2)}%</span>}</span>
              </button>
              <div className="act act--details">
                <div className="det-row">
                  <div className="det det--mkt"><span className="det-mkt disp">{position.marketSymbol}-PERP</span><span className={`det-side ${posSide === "LONG" ? "up" : "dn"}`}>{posSide === "LONG" ? "Up · Long" : "Down · Short"}</span></div>
                  <div className="det"><span className="det-k">Entry</span><span className="det-v num">{fmtPx(position.entryPriceUi)}</span></div>
                  <div className="det"><span className="det-k">Mark</span><span className="det-v num">{fmtPx(markUi)}</span></div>
                  <div className="det"><span className="det-k">Liq</span><span className="det-v num" style={{ color: "var(--red)" }}>{fmtPx(liqUi)}</span></div>
                  <div className="det"><span className="det-k">Size</span><span className="det-v num">{fmtPx(position.sizeUsdUi)}</span></div>
                  <div className="det"><span className="det-k">Collateral</span><span className="det-v num">{fmtPx(position.collateralUsdUi)}</span></div>
                  <div className="det"><span className="det-k">Lev</span><span className="det-v num">{posLev != null ? `${posLev.toFixed(posLev < 10 ? 1 : 0)}×` : "—"}</span></div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── notice ── */}
        {notice && (
          <div className={`notice notice--${notice.kind}`}>
            <Ghost size={34} className="notice-ic" />
            <div style={{ flex: 1 }}><div className="notice-title disp">{notice.title}</div><div className="notice-sub">{notice.sub}</div></div>
            {notice.kind === "fire" && <button className="notice-view" onClick={() => { setDrawer("stops"); setNotice(null); }}>View</button>}
            <button className="notice-x" onClick={() => setNotice(null)}><Icon name="x" size={16} /></button>
          </div>
        )}
        {toast && <button className="toast" onClick={() => setToast(null)}><span style={{ color: "var(--red)" }}>{toast}</span></button>}

        {/* tappable "?" explainer */}
        {glossary && GLOSSARY[glossary] && (
          <div className="glossary-pop" onClick={() => setGlossary(null)}>
            <div className="glossary-card" onClick={(e) => e.stopPropagation()}>
              <div className="glossary-title disp">{GLOSSARY[glossary].title}</div>
              <div className="glossary-body">{GLOSSARY[glossary].body}</div>
              <button className="btn btn--ghost btn--block" onClick={() => setGlossary(null)}>Got it</button>
            </div>
          </div>
        )}

        {/* one-tap confirm for irreversible actions */}
        {confirmAct && (
          <div className="glossary-pop" onClick={() => setConfirmAct(null)}>
            <div className="glossary-card" onClick={(e) => e.stopPropagation()}>
              <div className="glossary-title disp">{confirmAct.label}</div>
              <div className="row" style={{ gap: 10, marginTop: 12 }}>
                <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => setConfirmAct(null)}>Cancel</button>
                <button className={`btn ${confirmAct.kind === "close" ? "btn--primary" : "btn--accent"}`} style={{ flex: 1 }} onClick={() => { const r = confirmAct.run; setConfirmAct(null); r(); }}>{confirmAct.kind === "close" ? "Yes, close" : "Yes, flip"}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── stops drawer ── */}
      {drawer === "stops" && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="drawer">
            <div className="drawer-head"><Ghost size={32} /><span className="drawer-title disp">Ghost Stops</span><button className="drawer-x" onClick={() => setDrawer(null)}>✕</button></div>
            <div className="drawer-body">
              {!enabled && <div className="empty"><Ghost size={70} className="em-ghost" /><div className="em-title disp">Set up to add protection</div><div className="em-sub">Connect, set up your account, then any trade can carry a trailing stop that watches the price for you.</div></div>}
              {enabled && !registered && <div className="small" style={{ color: "var(--red)", fontWeight: 800 }}>Can&apos;t reach the price watcher right now — stops are paused.</div>}
              {enabled && registered && position && !protectedNow && stopsSupported(position.marketSymbol) && (
                <div className="order-card">
                  <div className="oc-title" style={{ marginBottom: 12 }}>Protect your {position.marketSymbol} {posSide === "LONG" ? "Up" : "Down"} bet <span className="muted small">(${position.sizeUsdUi})</span></div>
                  <div className="lev-chips" style={{ marginBottom: 12 }}>{TRAIL_PRESETS.map((b) => <button key={b} className={`chip ${trailBps === b ? "on" : ""}`} onClick={() => chooseTrail(b)}>{(b / 100).toFixed(b < 100 ? 1 : 0)}%</button>)}</div>
                  <button className="btn btn--primary btn--block" disabled={attaching} onClick={() => void attachStop()}>{attaching ? "Protecting…" : `Protect — sells if it falls ${(trailBps / 100).toFixed(trailBps < 100 ? 1 : 0)}%`}</button>
                </div>
              )}
              {enabled && registered && position && !protectedNow && !stopsSupported(position.marketSymbol) && (
                <div className="order-card">
                  <div className="oc-title" style={{ marginBottom: 8 }}>Protection isn&apos;t available for {position.marketSymbol} yet</div>
                  <div className="em-sub" style={{ textAlign: "left", marginBottom: 12 }}>Trailing stops need a live price feed we watch on-chain. Today that covers <b>{ghostMarkets.join(", ")}</b> — switch to one of those to protect a trade.</div>
                  <button className="btn btn--ghost btn--block" onClick={() => { setMarket(ghostMarkets[0] ?? "SOL"); setDrawer(null); }}>Switch to {ghostMarkets[0] ?? "SOL"}</button>
                </div>
              )}
              {stopUnsafe && <div className="liq-warn">⚠ Your live stop {stopUi != null ? `($${stopUi.toFixed(2)})` : ""} is below your liquidation {liqUi != null ? `($${liqUi.toFixed(2)})` : ""} at {posLev != null ? `${posLev.toFixed(0)}×` : "this leverage"} — you&apos;d be liquidated <b>before</b> it fires. Add collateral to drop your leverage, or close the trade.</div>}
              {activeStops.length > 0 && <div className="section-label">Live</div>}
              {activeStops.map((o) => {
                const p = allPositions.find((pp) => pp.marketSymbol.toUpperCase() === o.market.toUpperCase() && (pp.sideUi.toUpperCase() === "LONG") === o.isLong);
                return <OrderCard key={o.pda} order={o} markUi={markUi} entryUi={p ? num(p.entryPriceUi) : null} onCancel={cancelStop} onOpen={openMarket} />;
              })}
              {(() => {
                const hist = ghostOrders.filter((o) => o.state !== "active");
                if (hist.length === 0) return null;
                const shown = stopHist === "all" ? hist : hist.filter((o) => o.state === stopHist);
                return (
                  <>
                    <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                      <span className="section-label" style={{ margin: 0 }}>History</span>
                      <div className="hist-filters">
                        {(["all", "executed", "cancelled", "failed"] as const).map((f) => <button key={f} className={`hist-filter ${stopHist === f ? "on" : ""}`} onClick={() => setStopHist(f)}>{f === "all" ? "All" : f[0]!.toUpperCase() + f.slice(1)}</button>)}
                      </div>
                    </div>
                    {shown.length === 0
                      ? <div className="muted small" style={{ fontWeight: 700 }}>No {stopHist} stops.</div>
                      : shown.slice(0, 10).map((o) => <OrderCard key={o.pda} order={o} markUi={markUi} onCancel={cancelStop} onOpen={openMarket} />)}
                  </>
                );
              })()}
              {enabled && registered && !position && activeStops.length === 0 && <div className="empty"><Ghost size={70} className="em-ghost" /><div className="em-title disp">No protected trades yet</div><div className="em-sub">Open a trade with <b>Protect</b> on — your trailing stop appears here, follows the price, and sells for you if it reverses.</div></div>}
            </div>
          </div>
        </>
      )}

      {/* ── unprotected (at-risk) drawer ── */}
      {drawer === "risk" && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="drawer">
            <div className="drawer-head"><Icon name="alert" size={26} style={{ color: "var(--accent)" }} /><span className="drawer-title disp">Unprotected trades</span><button className="drawer-x" onClick={() => setDrawer(null)}>✕</button></div>
            <div className="drawer-body">
              {unprotectedPositions.length === 0 ? (
                <div className="empty"><Ghost size={70} className="em-ghost" /><div className="em-title disp">All trades protected</div><div className="em-sub">Every open position has a trailing stop watching it. Nice.</div></div>
              ) : (
                <>
                  <div className="em-sub" style={{ textAlign: "left" }}>These open trades have <b>no safety net</b> — add a trailing stop, or close them.</div>
                  {unprotectedPositions.map((p) => {
                    const side: TradeType = p.sideUi.toUpperCase() === "SHORT" ? "SHORT" : "LONG";
                    const pnl = num(p.pnlWithFeeUsdUi);
                    return (
                      <div key={`${p.marketSymbol}-${p.sideUi}`} className="risk-card">
                        <button className="risk-top" onClick={() => openMarket(p.marketSymbol)} title={`Open ${p.marketSymbol}`}>
                          <span className="tk" style={{ background: "var(--panel-2)", overflow: "hidden", padding: 0, width: 32, height: 32 }}><TokenLogo symbol={p.marketSymbol} size={30} /></span>
                          <span className="risk-id"><div className="mr-name">{p.marketSymbol} {side === "LONG" ? "Up" : "Down"}</div><div className="mr-sym">${p.sizeUsdUi} · {p.leverageUi}×</div></span>
                          <span className={`risk-pnl num ${pnl != null && pnl < 0 ? "dn" : "up"}`}>{pnl != null ? `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}` : "—"}</span>
                        </button>
                        <div className="risk-actions">
                          <button className="btn btn--primary" style={{ flex: 1 }} disabled={!stopsSupported(p.marketSymbol)} onClick={() => { setMarket(p.marketSymbol); setDrawer("stops"); }}>{stopsSupported(p.marketSymbol) ? "Protect" : "No feed"}</button>
                          <button className="btn btn--ghost" disabled={busyPos} onClick={() => setConfirmAct({ kind: "close", label: `Close your ${p.marketSymbol} ${side === "LONG" ? "Up" : "Down"} trade?`, run: () => void closePosition(p.marketSymbol, side) })}>Close</button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── modals ── */}
      {modal === "wallet" && <WalletModal onClose={() => setModal(null)} />}
      {modal === "enable" && <EnableModal onClose={() => setModal(null)} state={enableState} enabling={enabling} onRetry={() => void runEnable()} onDeposit={() => setModal("funds")} />}
      {modal === "funds" && <FundsModal onClose={() => setModal(null)} wallet={enableWallet} usdcMint={usdcMint} walletUsdc={balances.usdc} inBasketUsd={basketBal?.inBasketUsd ?? null} onLog={addLog} onMoved={() => { void refresh(); void balances.refresh(); void refreshBasket(); }} onSuccess={(kind, amt) => {
        const n = Number(amt);
        const usd = Number.isFinite(n) ? `$${n.toFixed(2)}` : "your USDC";
        if (typeof navigator !== "undefined") navigator.vibrate?.(15);
        setNotice(kind === "deposit"
          ? { kind: "good", title: "Deposit complete ✓", sub: `${usd} added to your trading balance — you're ready to trade.` }
          : { kind: "good", title: "Withdrawal complete ✓", sub: `${usd} is back in your wallet.` });
        setModal(null);
      }} />}
      {modal === "history" && <HistoryModal onClose={() => setModal(null)} entries={entries} walletUsdc={balances.usdc} inBasketUsd={basketBal?.inBasketUsd ?? null} onDisconnect={() => { void walletCtx.disconnect(); setModal(null); }} onFunds={() => setModal("funds")} connected={Boolean(walletPk)} pk={walletPk} />}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} theme={theme} setTheme={setTheme} chartStyle={chartStyle} setChartStyle={setChartStyle} density={density} setDensity={setDensity} />}
    </div>
  );
}

// ── modals ──────────────────────────────────────────────────────────────────

function ModalShell({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span className="modal-title disp">{title}</span><button className="modal-x" onClick={onClose}>✕</button></div>
        {sub && <div className="modal-sub">{sub}</div>}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallets, wallet, select, connect, connected, connecting } = useWallet();
  const [mounted, setMounted] = useState(false);
  const want = useRef(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (want.current && wallet && !connected && !connecting) { want.current = false; connect().catch(() => undefined); } }, [wallet, connected, connecting, connect]);
  useEffect(() => { if (connected) onClose(); }, [connected, onClose]);
  return (
    <ModalShell title="Connect wallet" sub="Pick a wallet, then sign a free message to prove ownership — no gas, no transaction." onClose={onClose}>
      <div className="need-box">
        <div className="need-title">What you&apos;ll need</div>
        <div className="need-row"><b>A Solana wallet</b> — Phantom, Solflare, or Backpack.</div>
        <div className="need-row"><b>Some USDC</b> — a dollar-pegged crypto you trade with.</div>
        <div className="need-row"><b>A little SOL</b> — ~$2 for one-time setup fees, refunded when you cash out.</div>
      </div>
      {mounted && wallets.map((w) => (
        <button key={w.adapter.name} className="wallet-opt" onClick={() => { want.current = true; select(w.adapter.name); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="wallet-icon"><img src={w.adapter.icon} alt="" width={26} height={26} /></span>
          <span style={{ flex: 1 }}><div className="wallet-name">{w.adapter.name}</div><div className="wallet-tag">{w.readyState === WalletReadyState.Installed ? "Detected" : "Not installed"}</div></span>
          <Icon name="chevron" />
        </button>
      ))}
      {mounted && wallets.length === 0 && <div className="muted small">No Solana wallet detected. Install Phantom, Solflare, or Backpack.</div>}
    </ModalShell>
  );
}

function EnableModal({ onClose, state, enabling, onRetry, onDeposit }: { onClose: () => void; state: EnableState | null; enabling: boolean; onRetry: () => void; onDeposit: () => void }) {
  const steps = state?.steps ?? [{ id: "session", label: "Securing instant trading", status: "idle" }, { id: "basket", label: "Creating your account", status: "idle" }, { id: "ledger", label: "Setting up your balance", status: "idle" }, { id: "delegate", label: "Connecting to the rollup", status: "idle" }];
  return (
    <ModalShell title="Set up your account" sub="One tap sets up instant, gas-free trading. This does NOT give us access to your funds — you approve every deposit separately and can revoke anytime." onClose={enabling ? () => undefined : onClose}>
      {steps.map((s) => (
        <div key={s.id} className={`step ${s.status === "done" ? "done" : s.status === "active" ? "active" : ""}`}>
          <span className="step-dot">{s.status === "done" ? "✓" : s.status === "active" ? "·" : ""}</span>
          <span className="step-text">{s.label}</span>
          {s.status === "active" && <span className="spin" />}
        </div>
      ))}
      {state?.fundingHint && <div className="small" style={{ color: "var(--muted)", fontWeight: 700, lineHeight: 1.5 }}>{state.fundingHint}</div>}
      {state?.error && !state?.fundingHint && <div className="small" style={{ color: "var(--red)", fontWeight: 700 }}>{state.error}</div>}
      {state?.fundingHint && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <a className="btn btn--ghost" href="https://www.coinbase.com/price/solana" target="_blank" rel="noreferrer">Get SOL</a>
          <a className="btn btn--ghost" href="https://phantom.app/learn/crypto-101/what-is-usdc" target="_blank" rel="noreferrer">Get USDC</a>
        </div>
      )}
      {state?.needsUsdc && !enabling && <button className="btn btn--primary btn--block" onClick={onDeposit}>Add USDC</button>}
      {state?.phase === "stopped" && !enabling && <button className="btn btn--ghost btn--block" onClick={onRetry}>Try again</button>}
    </ModalShell>
  );
}

function FundsModal({ onClose, wallet, usdcMint, walletUsdc, inBasketUsd, onLog, onMoved, onSuccess }: { onClose: () => void; wallet: EnableWalletCtx | null; usdcMint: string | null; walletUsdc: number | null; inBasketUsd: number | null; onLog: (e: Omit<LatencyEntry, "id" | "at">) => void; onMoved: () => void; onSuccess: (kind: "deposit" | "withdraw", amount: string) => void }) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("25");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<FundsStep | null>(null);
  const [pending, setPending] = useState(false);
  const max = tab === "deposit" ? walletUsdc : inBasketUsd;
  const run = async () => {
    if (!wallet || !usdcMint || busy || !(Number(amount) > 0)) return;
    const amt = amount;
    setBusy(true); setStep(null); setPending(false);
    try { const fn = tab === "deposit" ? depositUsdc : withdrawUsdc; const r = await fn({ wallet, usdcMint, amount, onStep: setStep, onLog }); if (r.ok) { onMoved(); onSuccess(tab, amt); } else if ("executePending" in r && r.executePending) setPending(true); }
    finally { setBusy(false); }
  };
  const retry = async () => { if (!wallet || !usdcMint || busy) return; const amt = amount; setBusy(true); try { const r = await executeWithdrawalStep({ wallet, usdcMint, onStep: setStep, onLog }); if (r.ok) { onMoved(); onSuccess("withdraw", amt); setPending(false); } } finally { setBusy(false); } };
  return (
    <ModalShell title="Add or withdraw USDC" sub={tab === "deposit" ? "Move USDC from your wallet into your trading balance. You can withdraw anytime — your funds stay yours." : undefined} onClose={busy ? () => undefined : onClose}>
      <div className="seg-tabs">{(["deposit", "withdraw"] as const).map((t) => <button key={t} className={`dtab ${tab === t ? "on" : ""}`} onClick={() => { setTab(t); setStep(null); setPending(false); }}>{t === "deposit" ? "Add" : "Withdraw"}</button>)}</div>
      <div className="field-cap" style={{ marginTop: 4 }}><span>amount</span><button className="muted" style={{ background: "none" }} onClick={() => max && setAmount(String(Math.floor(max * 100) / 100))}>{tab === "deposit" ? "in your wallet" : "ready to trade"} ${(max ?? 0).toFixed(2)}</button></div>
      <div className="big-input"><span className="cur">$</span><input value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))} placeholder="0" inputMode="decimal" /><span className="muted" style={{ fontWeight: 800, fontSize: 13 }}>USDC</span></div>
      {step && <div className="small" style={{ color: step.phase === "error" ? "var(--red)" : "var(--muted)", fontWeight: 700 }}>{step.note ?? step.label}</div>}
      {pending ? <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void retry()}>{busy ? "…" : "Try again"}</button>
        : <button className="btn btn--primary btn--block" disabled={busy || !(Number(amount) > 0) || !wallet} onClick={() => void run()}>{busy ? "…" : tab === "deposit" ? `Add $${Number(amount) > 0 ? Number(amount).toFixed(0) : ""} USDC` : "Withdraw USDC"}</button>}
    </ModalShell>
  );
}

type HistFilter = "all" | "trade" | "funds";
function histCategory(e: LatencyEntry): "trade" | "funds" | "other" {
  const a = e.action.toLowerCase();
  if (e.trade || /^(long|short|close|reverse)/.test(a)) return "trade";
  if (/deposit|withdraw|usdc/.test(a)) return "funds";
  return "other";
}

function HistoryModal({ onClose, entries, walletUsdc, inBasketUsd, onDisconnect, onFunds, connected, pk }: { onClose: () => void; entries: LatencyEntry[]; walletUsdc: number | null; inBasketUsd: number | null; onDisconnect: () => void; onFunds: () => void; connected: boolean; pk: string | null }) {
  const [filter, setFilter] = useState<HistFilter>("all");
  const shown = filter === "all" ? entries : entries.filter((e) => histCategory(e) === filter);
  const FILTERS: { key: HistFilter; label: string }[] = [{ key: "all", label: "All" }, { key: "trade", label: "Trades" }, { key: "funds", label: "Funds" }];
  return (
    <ModalShell title="Your account" sub={pk ? `Your wallet · ${shortKey(pk)}` : undefined} onClose={onClose}>
      {connected && (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}><span className="muted small" style={{ fontWeight: 800 }}>In your wallet</span><span className="num" style={{ fontWeight: 800 }}>${(walletUsdc ?? 0).toFixed(2)}</span></div>
          <div className="row" style={{ justifyContent: "space-between" }}><span className="muted small" style={{ fontWeight: 800 }}>Ready to trade</span><span className="num" style={{ fontWeight: 800 }}>${(inBasketUsd ?? 0).toFixed(2)}</span></div>
          <div className="row" style={{ gap: 8 }}><button className="btn btn--primary" style={{ flex: 1 }} onClick={onFunds}>Add / Withdraw</button><button className="btn btn--ghost" onClick={onDisconnect}>Disconnect</button></div>
        </>
      )}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <span className="section-label" style={{ margin: 0 }}>Recent activity</span>
        {entries.length > 0 && (
          <div className="hist-filters">
            {FILTERS.map((f) => <button key={f.key} className={`hist-filter ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>)}
          </div>
        )}
      </div>
      {entries.length === 0 ? <div className="muted small" style={{ fontWeight: 700 }}>Nothing yet. Every confirmed action lands here with its confirm time and a link to view it on Solana.</div>
        : shown.length === 0 ? <div className="muted small" style={{ fontWeight: 700 }}>No {filter === "trade" ? "trades" : "fund moves"} this session yet.</div>
        : shown.map((e) => (
          <div key={e.id} className="hist-row">
            <span className={`hist-dot ${e.chain === "er" ? "hd-good" : "hd-info"}`} />
            <span className="hist-label">{e.action}</span>
            <a className="hist-sig" href={explorerLink(e.signature, e.chain === "er" ? FLASH_ER_RPC : null)} target="_blank" rel="noreferrer" title="View on Solana Explorer">{shortKey(e.signature)} ↗</a>
            <span className="hist-time">{e.ms}ms</span>
          </div>
        ))}
    </ModalShell>
  );
}

function SettingsModal({ onClose, theme, setTheme, chartStyle, setChartStyle, density, setDensity }: { onClose: () => void; theme: string; setTheme: (t: string) => void; chartStyle: "line" | "candles"; setChartStyle: (c: "line" | "candles") => void; density: "compact" | "regular" | "comfy"; setDensity: (d: "compact" | "regular" | "comfy") => void }) {
  return (
    <ModalShell title="Settings" onClose={onClose}>
      <div className="section-label">Palette</div>
      <div className="pal-grid">
        {THEMES.map((k) => { const sw = THEME_SW[k]!; return (
          <button key={k} className={`pal ${theme === k ? "on" : ""}`} style={{ background: sw[0] }} onClick={() => setTheme(k)}>
            <span className="pal-sw"><span style={{ background: sw[1] }} /><span style={{ background: sw[2] }} /></span>
            <div className="pal-name" style={{ color: sw[1] }}>{k}</div>
          </button>
        ); })}
      </div>
      <div className="section-label">Chart style</div>
      <div className="seg-tabs">{(["line", "candles"] as const).map((c) => <button key={c} className={`dtab ${chartStyle === c ? "on" : ""}`} onClick={() => setChartStyle(c)}>{c[0]!.toUpperCase() + c.slice(1)}</button>)}</div>
      <div className="section-label">Density</div>
      <div className="seg-tabs">{(["compact", "regular", "comfy"] as const).map((d) => <button key={d} className={`dtab ${density === d ? "on" : ""}`} onClick={() => setDensity(d)}>{d[0]!.toUpperCase() + d.slice(1)}</button>)}</div>
      <div className="section-label">Built on</div>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", opacity: 0.9 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/flash.png" alt="Flash Trade" style={{ height: 16, width: "auto" }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/magicblock.svg" alt="MagicBlock" style={{ height: 15, width: "auto" }} />
      </div>
    </ModalShell>
  );
}
