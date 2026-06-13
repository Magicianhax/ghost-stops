// components/gummy/gummy-terminal.tsx — the Ghost Stops terminal in the "Money
// Gummy" aesthetic from the Claude Design handoff: a full-bleed themed chart
// under floating chunky chrome (topbar, expanding trade terminal, action zone,
// side drawers, centered modals, fire/execute notice). Real integration
// throughout — wallet, Flash V2 trades, on-chain Ghost Stops — reusing the
// existing data hooks and actions; only the presentation is new. Palette + chart
// style + density live in an in-app Settings modal, persisted to localStorage.

"use client";

import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { FlashV2Error, type PositionMetrics, type TradeType } from "flash-v2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ghost, Icon } from "@/components/gummy/ghost";
import { TokenLogo } from "@/components/token-logo";
import { GummyChart } from "@/components/gummy/gummy-chart";
import { OrderCard } from "@/components/gummy/order-card";
import { enableOneClickTrading, type EnableState, type EnableWalletCtx } from "@/lib/enable";
import { depositUsdc, executeWithdrawalStep, withdrawUsdc, type FundsStep } from "@/lib/funds";
import { COLLATERAL, flash, MARKETS } from "@/lib/flash";
import { computePositionView, fmtMs, fmtPnlUsd, num, shortKey } from "@/lib/format";
import { useBalances, useBasketBalance, useLatencyLog, useMarketLimits, useMarkets, useOwner, usePrice, useUsdcMint, type LatencyEntry } from "@/lib/hooks";
import { loadSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner } from "@/lib/signer";
import { usePriceHistory } from "@/lib/use-price-history";
import { cancelGhostOrder, clearAuthToken, createGhostOrder, ghostStopLevel, hasAuthToken, rawToUi, registerSessionWithExecutor, signInWithExecutor, useGhostOrders } from "@/lib/ghost";
import "@/app/terminal.css";

const THEMES = ["gummy", "grape", "tangerine", "ice", "sticker"] as const;
const THEME_SW: Record<string, [string, string, string]> = {
  gummy: ["#0c1f17", "#5cf0a8", "#ffe06b"], grape: ["#15102b", "#b69bff", "#7af0d0"],
  tangerine: ["#2a1808", "#ffb454", "#7af0d0"], ice: ["#0a1e2c", "#5fd6ff", "#ffe06b"], sticker: ["#fef0dd", "#36c97f", "#ff9ec9"],
};

function errMsg(e: unknown): string {
  const raw = e instanceof FlashV2Error ? e.message : e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|502/i.test(raw)) return "Can't reach the RPC right now; nothing was submitted.";
  if (/429|Too Many Requests/i.test(raw)) return "RPC is rate-limiting. Set NEXT_PUBLIC_BASE_RPC to your own RPC.";
  return raw;
}

export default function GummyTerminal() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={flash.network.baseRpc}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <Inner />
      </WalletProvider>
    </ConnectionProvider>
  );
}

type ModalId = "wallet" | "enable" | "funds" | "history" | "settings" | null;
type DrawerId = "stops" | "markets" | null;

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

  const { snapshot, status, refresh } = useOwner(walletPk);
  const usdcMint = useUsdcMint();
  const balances = useBalances(walletPk, usdcMint);
  const { price, drift } = usePrice(market, 1000);
  const history = usePriceHistory(price, market);
  const { entries, add: addLog } = useLatencyLog();
  const limits = useMarketLimits(market);
  const { bal: basketBal, refresh: refreshBasket } = useBasketBalance(walletPk, snapshot?.basketPubkey ?? null, usdcMint);
  const ghostOrders = useGhostOrders(walletPk);

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
  const [termOpen, setTermOpen] = useState(true);
  const [sizeUsd, setSizeUsd] = useState("");
  const [lev, setLev] = useState(5);
  const [busySide, setBusySide] = useState<TradeType | null>(null);
  const [busyPos, setBusyPos] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [trailBps, setTrailBps] = useState(50);
  const [registered, setRegistered] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableState, setEnableState] = useState<EnableState | null>(null);
  const [notice, setNotice] = useState<{ kind: "fire" | "good" | "bad"; title: string; sub: string } | null>(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);

  // fire/execute notice from order state transitions
  const prevStates = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const o of ghostOrders) {
      const prev = prevStates.current[o.pda];
      if (prev && prev !== o.state) {
        if (o.state === "fired") setNotice({ kind: "fire", title: "Ghost Stop fired ⚡", sub: `${o.market} ${o.isLong ? "LONG" : "SHORT"} closing on Flash` });
        else if (o.state === "executed") setNotice({ kind: "good", title: "Stop executed ✓", sub: `${o.market} position closed` });
        else if (o.state === "failed") setNotice({ kind: "bad", title: "Stop failed", sub: "Position untouched" });
      }
      prevStates.current[o.pda] = o.state;
    }
  }, [ghostOrders]);

  // sign-in on connect
  const signingIn = useRef(false);
  useEffect(() => {
    const sm = walletCtx.signMessage;
    if (!walletPk || hasAuthToken(walletPk) || signingIn.current || !sm) return;
    signingIn.current = true;
    void (async () => {
      try { await signInWithExecutor(walletPk, sm); }
      catch (e) { clearAuthToken(); setToast(`Sign-in declined. ${errMsg(e)}`); void walletCtx.disconnect().catch(() => undefined); }
      finally { signingIn.current = false; }
    })();
  }, [walletPk, walletCtx]);

  useEffect(() => {
    setRegistered(false);
    if (!session) return;
    let dead = false;
    registerSessionWithExecutor(session).then(() => !dead && setRegistered(true)).catch(() => !dead && setRegistered(false));
    return () => { dead = true; };
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard: arrows to trade when flat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setModal(null); setDrawer(null); return; }
      if (modal || !enabled || position || busySide) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); void openPosition("LONG"); }
      if (e.key === "ArrowLeft") { e.preventDefault(); void openPosition("SHORT"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── actions ─────────────────────────────────────────────────────────────────
  const openPosition = useCallback(async (side: TradeType) => {
    if (!signer || busySide) return;
    const amt = sizeUsd || "11";
    setBusySide(side);
    try {
      const q = await flash.openPosition({ inputTokenSymbol: COLLATERAL, outputTokenSymbol: market, inputAmountUi: amt, leverage: lev, tradeType: side, orderType: "MARKET", owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!q.transactionBase64) throw new Error("no transaction");
      const { signature, confirmMs } = await signer.sendTrade(q.transactionBase64);
      addLog({ action: `${side} ${lev}×`, chain: "er", ms: confirmMs, signature, trade: { market, side, entryUi: markUi, collateralUi: Number(amt) || null, pnlUi: null } });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusySide(null); }
  }, [signer, busySide, sizeUsd, lev, market, markUi, addLog]);

  const closePosition = useCallback(async (mkt: string, side: TradeType) => {
    if (!signer) return;
    setBusyPos(true);
    try {
      const c = await flash.closePosition({ marketSymbol: mkt, side, inputUsdUi: "0", withdrawTokenSymbol: COLLATERAL, owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!c.transactionBase64) throw new Error("no transaction");
      const { signature, confirmMs } = await signer.sendTrade(c.transactionBase64);
      addLog({ action: `CLOSE ${side}`, chain: "er", ms: confirmMs, signature, trade: { market: mkt, side, entryUi: null, collateralUi: null, pnlUi: null } });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusyPos(false); }
  }, [signer, addLog]);

  const reversePosition = useCallback(async (mkt: string, side: TradeType) => {
    if (!signer) return;
    setBusyPos(true);
    const newSide: TradeType = side === "LONG" ? "SHORT" : "LONG";
    try {
      const b = await flash.reversePosition({ marketSymbol: mkt, side, leverage: lev, owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!b.transactionBase64) throw new Error("no transaction");
      const { signature, confirmMs } = await signer.sendTrade(b.transactionBase64);
      addLog({ action: `REVERSE → ${newSide}`, chain: "er", ms: confirmMs, signature, trade: { market: mkt, side: newSide, entryUi: markUi, collateralUi: null, pnlUi: null } });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusyPos(false); }
  }, [signer, lev, markUi, addLog]);

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
    setAttaching(true);
    try {
      await createGhostOrder({ owner: walletPk, market: position.marketSymbol, kind: "trailing", trailingBps: trailBps, sizePctBps: 10000, isLong: position.sideUi.toUpperCase() === "LONG" });
      setDrawer("stops");
    } catch (e) { setToast(errMsg(e)); }
    finally { setAttaching(false); }
  }, [walletPk, position, attaching, trailBps]);

  const cancelStop = useCallback((pda: string) => { void cancelGhostOrder(pda).catch((e) => setToast(errMsg(e))); }, []);

  // ── derived view state ──────────────────────────────────────────────────────
  const posView = position ? computePositionView(position, markUi) : null;
  const posSide: TradeType = position?.sideUi.toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const activeStops = ghostOrders.filter((o) => o.state === "active");
  const protectedNow = activeStops.some((o) => position && o.market === position.marketSymbol && o.isLong === (posSide === "LONG"));
  const live = walletPk ? status === "open" : price !== null;
  const connClass = !live ? "off" : status === "polling" ? "poll" : "";
  const lastErMs = entries.find((e) => e.chain === "er")?.ms ?? null;
  const priceTxt = price ? price.priceUi.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  const enableWallet: EnableWalletCtx | null = walletCtx.publicKey && walletCtx.signTransaction ? { publicKey: walletCtx.publicKey, signTransaction: walletCtx.signTransaction, signAllTransactions: walletCtx.signAllTransactions } : null;
  const phase = !walletPk ? "connect" : !enabled ? "enable" : (basketBal !== null && basketBal.inBasketUsd < 0.01) ? "deposit" : position ? "position" : "flat";
  const activeStop = activeStops.find((o) => position && o.market === position.marketSymbol);
  const stopUi = activeStop ? rawToUi(ghostStopLevel(activeStop)) : null;

  return (
    <div className="gs-terminal app" data-theme={theme} data-density={density === "regular" ? undefined : density}>
      <GummyChart points={history} entryPrice={position ? num(position.entryPriceUi) : null} stopPrice={stopUi} liqPrice={position ? num(position.liquidationPriceUi) : null} pnlSign={posView ? (posView.pnlUsd >= 0 ? 1 : -1) : 0} style={chartStyle} />

      <div className="hud">
        {/* ── top bar ── */}
        <div className="topbar">
          <div className="seg seg--brand"><Ghost size={36} float /><span className="brand-name disp">Ghost Stops</span></div>
          <button className="seg seg--market" onClick={() => setDrawer("markets")}>
            <span className="tk" style={{ background: "var(--panel-2)", overflow: "hidden", padding: 0 }}><TokenLogo symbol={market} size={28} /></span>
            <span className="market-meta"><span className="pair">{market}-PERP</span><span className={`pair-px num ${drift === "down" ? "dn" : ""}`}>{priceTxt} {drift === "down" ? "▼" : "▲"}</span></span>
            <span className="caret">▾</span>
          </button>
          <div className="spacer" />
          <button className="seg seg-btn" onClick={() => setDrawer("stops")}><Icon name="pulse" className="gi" /><span className="seg-label">Stops</span>{activeStops.length > 0 && <span className="badge live">{activeStops.length}</span>}</button>
          <button className="seg seg--lat" onClick={() => setModal("history")}><span className={`conn-dot ${connClass}`} /><span className="lat-text">{lastErMs === null ? "live" : <b>{fmtMs(lastErMs)}</b>}</span></button>
          {walletPk ? (
            <button className="seg seg--wallet" onClick={() => setModal("history")}>
              <span className="market-meta"><span className="bal num">${(basketBal?.inBasketUsd ?? 0).toFixed(2)}</span><span className="bal-sub">in basket</span></span>
              <span className="av" />
            </button>
          ) : (
            <button className="seg seg--connect"><span className="btn btn--accent" onClick={() => setModal("wallet")} style={{ boxShadow: "none", border: "none" }}>Connect</span></button>
          )}
          <button className="seg seg--icon" onClick={() => setModal("settings")} title="Settings"><Icon name="gear" size={20} /></button>
        </div>

        {/* ── trade terminal (bottom-left) ── */}
        {(phase === "flat" || phase === "position") && (
          <div className="terminal">
            {!termOpen ? (
              <div className="term-collapsed" onClick={() => setTermOpen(true)}>
                <div className="term-sum"><div><div className="k">size</div><div className="v num">${sizeUsd || "—"}</div></div><div><div className="k">lev</div><div className="v num">{lev}×</div></div></div>
                <span className="term-open-cta">edit ▸</span>
              </div>
            ) : (
              <div className="term-body">
                <div className="term-head"><span className="term-title disp">Trade {market}</span><button className="term-x" onClick={() => setTermOpen(false)}>–</button></div>
                <div className="field-cap"><span>amount</span><button onClick={() => freeUsd && setSizeUsd(String(Math.floor(freeUsd * 100) / 100))} className="muted" style={{ background: "none" }}>free ${(freeUsd ?? 0).toFixed(2)}</button></div>
                <div className="amount-wrap"><span className="amount-cur">$</span><input className="amount-input" value={sizeUsd} onChange={(e) => setSizeUsd(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))} placeholder="0" inputMode="decimal" /></div>
                <div className="preset-row">{["11", "25", "50", "100"].map((p) => <button key={p} className="preset" onClick={() => setSizeUsd(p)}>${p}</button>)}</div>
                <div className="lev-block">
                  <div className="field-cap"><span>leverage</span><span className="lev-val num">{lev.toFixed(lev < 10 ? 1 : 0)}×</span></div>
                  <input type="range" className="gummy-range" min={limits?.minLeverage ?? 1.1} max={limits?.maxLeverage ?? 100} step={0.1} value={lev} onChange={(e) => setLev(Number(e.target.value))} />
                  <div className="lev-chips">{[2, 5, 10, 20].filter((c) => c <= (limits?.maxLeverage ?? 100)).map((c) => <button key={c} className={`chip ${Math.round(lev) === c ? "on" : ""}`} onClick={() => setLev(c)}>{c}×</button>)}</div>
                </div>
                <div className="fee-row"><span>est. value</span><b className="num">${((Number(sizeUsd) || 0) * lev).toFixed(2)}</b></div>
              </div>
            )}
          </div>
        )}

        {/* ── action zone ── */}
        <div className="actionzone">
          {phase === "connect" && <button className="act act--connect act-grow" onClick={() => setModal("wallet")}><span className="act-cta-big disp">Connect wallet</span></button>}
          {phase === "enable" && <button className="act act--enable act-grow" onClick={() => void runEnable()}><span className="act-cta-big disp">{enabling ? "Enabling…" : "Enable one-click trading"}</span></button>}
          {phase === "deposit" && <button className="act act--deposit act-grow" onClick={() => setModal("funds")}><span className="act-cta-big disp">Deposit USDC to start</span></button>}
          {phase === "flat" && (
            <>
              <button className={`act act--short act-grow act-side ${busySide === "SHORT" ? "flash-on" : ""}`} onClick={() => void openPosition("SHORT")} disabled={busySide !== null}><span className="big disp">{busySide === "SHORT" ? "Opening…" : <>SHORT <Icon name="down" size={26} /></>}</span><span className="small">tap or ← key</span></button>
              <button className={`act act--long act-grow act-side ${busySide === "LONG" ? "flash-on" : ""}`} onClick={() => void openPosition("LONG")} disabled={busySide !== null}><span className="big disp">{busySide === "LONG" ? "Opening…" : <>LONG <Icon name="up" size={26} /></>}</span><span className="small">tap or → key</span></button>
            </>
          )}
          {phase === "position" && position && (
            <>
              <button className="act act--reverse" onClick={() => void reversePosition(position.marketSymbol, posSide)} disabled={busyPos}><span className="act-cta-big disp"><Icon name="swap" size={20} /> Reverse</span></button>
              <button className={`act act--close act-grow ${(posView?.pnlUsd ?? 0) < 0 ? "neg" : ""}`} onClick={() => void closePosition(position.marketSymbol, posSide)} disabled={busyPos}>
                <span className="act-side" style={{ alignItems: "flex-start" }}><span className="act-k">{busyPos ? "closing" : "close position"}</span><span className="big disp">{position.marketSymbol} {posSide}</span></span>
                <span className="act-pnl num">{posView ? fmtPnlUsd(posView.pnlUsd) : "—"}</span>
              </button>
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
      </div>

      {/* ── stops drawer ── */}
      {drawer === "stops" && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="drawer">
            <div className="drawer-head"><Ghost size={32} /><span className="drawer-title disp">Ghost Stops</span><button className="drawer-x" onClick={() => setDrawer(null)}>✕</button></div>
            <div className="drawer-body">
              {!enabled && <div className="empty"><Ghost size={70} className="em-ghost" /><div className="em-title disp">Enable to arm stops</div><div className="em-sub">Connect and enable one-click trading, then attach a trailing stop to a position.</div></div>}
              {enabled && !registered && <div className="small" style={{ color: "var(--red)", fontWeight: 800 }}>Executor unreachable — stops can&apos;t fire.</div>}
              {enabled && registered && position && !protectedNow && (
                <div className="order-card">
                  <div className="oc-title" style={{ marginBottom: 12 }}>Protect {position.marketSymbol} {posSide} <span className="muted small">(${position.sizeUsdUi})</span></div>
                  <div className="lev-chips" style={{ marginBottom: 12 }}>{[10, 50, 100, 200].map((b) => <button key={b} className={`chip ${trailBps === b ? "on" : ""}`} onClick={() => setTrailBps(b)}>{(b / 100).toFixed(b < 100 ? 1 : 0)}%</button>)}</div>
                  <button className="btn btn--primary btn--block" disabled={attaching} onClick={() => void attachStop()}>{attaching ? "Attaching…" : `Attach trailing stop ${(trailBps / 100).toFixed(1)}%`}</button>
                </div>
              )}
              {activeStops.length > 0 && <div className="section-label">Live</div>}
              {activeStops.map((o) => <OrderCard key={o.pda} order={o} markUi={markUi} onCancel={cancelStop} />)}
              {ghostOrders.filter((o) => o.state !== "active").length > 0 && <div className="section-label">History</div>}
              {ghostOrders.filter((o) => o.state !== "active").slice(0, 6).map((o) => <OrderCard key={o.pda} order={o} markUi={markUi} onCancel={cancelStop} />)}
              {enabled && registered && !position && activeStops.length === 0 && <div className="empty"><Ghost size={70} className="em-ghost" /><div className="em-title disp">No stops yet</div><div className="em-sub">Open a position, then attach a trailing stop here. It trails on-chain and fires when price reverses.</div></div>}
            </div>
          </div>
        </>
      )}

      {/* ── market drawer ── */}
      {drawer === "markets" && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <div className="drawer">
            <div className="drawer-head"><span className="drawer-title disp">Markets</span><button className="drawer-x" onClick={() => setDrawer(null)}>✕</button></div>
            <div className="drawer-body">
              {markets.map((m) => (
                <button key={m} className={`market-row ${m === market ? "on" : ""}`} onClick={() => { setMarket(m); setDrawer(null); }}>
                  <span className="tk" style={{ background: "var(--panel-2)", overflow: "hidden", padding: 0, width: 32, height: 32 }}><TokenLogo symbol={m} size={30} /></span>
                  <span><div className="mr-name">{m}-PERP</div><div className="mr-sym">{m}/USDC</div></span>
                  {m === market && <span className="mr-px"><span className="up" style={{ fontWeight: 800, fontSize: 12 }}>active</span></span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── modals ── */}
      {modal === "wallet" && <WalletModal onClose={() => setModal(null)} />}
      {modal === "enable" && <EnableModal onClose={() => setModal(null)} state={enableState} enabling={enabling} onRetry={() => void runEnable()} onDeposit={() => setModal("funds")} />}
      {modal === "funds" && <FundsModal onClose={() => setModal(null)} wallet={enableWallet} usdcMint={usdcMint} walletUsdc={balances.usdc} inBasketUsd={basketBal?.inBasketUsd ?? null} onLog={addLog} onMoved={() => { void refresh(); void balances.refresh(); void refreshBasket(); }} />}
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
    <ModalShell title="Connect wallet" sub="Pick a wallet, then sign a free message to prove ownership." onClose={onClose}>
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
  const steps = state?.steps ?? [{ id: "session", label: "Session key", status: "idle" }, { id: "basket", label: "Basket", status: "idle" }, { id: "ledger", label: "Deposit ledger", status: "idle" }, { id: "delegate", label: "Delegate to rollup", status: "idle" }];
  return (
    <ModalShell title="Enable one-click trading" sub="One signature. No funds move; only a 0.01 SOL rent top-up (recoverable)." onClose={enabling ? () => undefined : onClose}>
      {steps.map((s) => (
        <div key={s.id} className={`step ${s.status === "done" ? "done" : s.status === "active" ? "active" : ""}`}>
          <span className="step-dot">{s.status === "done" ? "✓" : s.status === "active" ? "·" : ""}</span>
          <span className="step-text">{s.label}</span>
          {s.status === "active" && <span className="spin" />}
        </div>
      ))}
      {state?.error && <div className="small" style={{ color: "var(--red)", fontWeight: 700 }}>{state.error}</div>}
      {state?.needsUsdc && !enabling && <button className="btn btn--primary btn--block" onClick={onDeposit}>Deposit USDC</button>}
      {state?.phase === "stopped" && !enabling && <button className="btn btn--ghost btn--block" onClick={onRetry}>Retry</button>}
    </ModalShell>
  );
}

function FundsModal({ onClose, wallet, usdcMint, walletUsdc, inBasketUsd, onLog, onMoved }: { onClose: () => void; wallet: EnableWalletCtx | null; usdcMint: string | null; walletUsdc: number | null; inBasketUsd: number | null; onLog: (e: Omit<LatencyEntry, "id" | "at">) => void; onMoved: () => void }) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<FundsStep | null>(null);
  const [pending, setPending] = useState(false);
  const max = tab === "deposit" ? walletUsdc : inBasketUsd;
  const run = async () => {
    if (!wallet || !usdcMint || busy || !(Number(amount) > 0)) return;
    setBusy(true); setStep(null); setPending(false);
    try { const fn = tab === "deposit" ? depositUsdc : withdrawUsdc; const r = await fn({ wallet, usdcMint, amount, onStep: setStep, onLog }); if (r.ok) { onMoved(); setAmount(""); } else if ("executePending" in r && r.executePending) setPending(true); }
    finally { setBusy(false); }
  };
  const retry = async () => { if (!wallet || !usdcMint || busy) return; setBusy(true); try { const r = await executeWithdrawalStep({ wallet, usdcMint, onStep: setStep, onLog }); if (r.ok) { onMoved(); setPending(false); setAmount(""); } } finally { setBusy(false); } };
  return (
    <ModalShell title="Funds" onClose={busy ? () => undefined : onClose}>
      <div className="seg-tabs">{(["deposit", "withdraw"] as const).map((t) => <button key={t} className={`dtab ${tab === t ? "on" : ""}`} onClick={() => { setTab(t); setStep(null); setPending(false); }}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}</div>
      <div className="field-cap" style={{ marginTop: 4 }}><span>amount</span><button className="muted" style={{ background: "none" }} onClick={() => max && setAmount(String(Math.floor(max * 100) / 100))}>{tab === "deposit" ? "wallet" : "basket"} ${(max ?? 0).toFixed(2)}</button></div>
      <div className="big-input"><span className="cur">$</span><input value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))} placeholder="0" inputMode="decimal" /><span className="muted" style={{ fontWeight: 800, fontSize: 13 }}>USDC</span></div>
      {step && <div className="small" style={{ color: step.phase === "error" ? "var(--red)" : "var(--muted)", fontWeight: 700 }}>{step.note ?? step.label}</div>}
      {pending ? <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void retry()}>{busy ? "…" : "Execute again"}</button>
        : <button className="btn btn--primary btn--block" disabled={busy || !(Number(amount) > 0) || !wallet} onClick={() => void run()}>{busy ? "…" : tab === "deposit" ? "Deposit USDC" : "Withdraw USDC"}</button>}
    </ModalShell>
  );
}

function HistoryModal({ onClose, entries, walletUsdc, inBasketUsd, onDisconnect, onFunds, connected, pk }: { onClose: () => void; entries: LatencyEntry[]; walletUsdc: number | null; inBasketUsd: number | null; onDisconnect: () => void; onFunds: () => void; connected: boolean; pk: string | null }) {
  return (
    <ModalShell title="Activity" sub={pk ? shortKey(pk) : undefined} onClose={onClose}>
      {connected && (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}><span className="muted small" style={{ fontWeight: 800 }}>WALLET</span><span className="num" style={{ fontWeight: 800 }}>${(walletUsdc ?? 0).toFixed(2)}</span></div>
          <div className="row" style={{ justifyContent: "space-between" }}><span className="muted small" style={{ fontWeight: 800 }}>IN BASKET</span><span className="num" style={{ fontWeight: 800 }}>${(inBasketUsd ?? 0).toFixed(2)}</span></div>
          <div className="row" style={{ gap: 8 }}><button className="btn btn--primary" style={{ flex: 1 }} onClick={onFunds}>Deposit / Withdraw</button><button className="btn btn--ghost" onClick={onDisconnect}>Disconnect</button></div>
          <div className="section-label">Session activity</div>
        </>
      )}
      {entries.length === 0 ? <div className="muted small" style={{ fontWeight: 700 }}>Nothing yet. Every confirmed action lands here with its confirm time and signature.</div>
        : entries.map((e) => (
          <div key={e.id} className="hist-row">
            <span className={`hist-dot ${e.chain === "er" ? "hd-good" : "hd-info"}`} />
            <span className="hist-label">{e.action}</span>
            <a className="hist-sig" href={`https://explorer.solana.com/tx/${e.signature}`} target="_blank" rel="noreferrer">{shortKey(e.signature)}</a>
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
    </ModalShell>
  );
}
