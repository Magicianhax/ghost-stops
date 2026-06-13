// components/terminal/ghost-terminal.tsx — the application shell. Wires wallet
// providers, live data, and every action (open/close/reverse, enable, sign-in,
// attach/cancel stops), then lays it out as a multi-panel terminal: chart +
// positions on the left, order ticket + Ghost Stops on the right rail.

"use client";

import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { FlashV2Error, type TradeType } from "flash-v2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/terminal/panel";
import { TermHeader } from "@/components/terminal/term-header";
import { TermChart } from "@/components/terminal/term-chart";
import { OrderTicket } from "@/components/terminal/order-ticket";
import { PositionsPanel } from "@/components/terminal/positions-panel";
import { StopsPanel } from "@/components/terminal/stops-panel";
import { EnableModal } from "@/components/terminal/enable-modal";
import { FundsModal } from "@/components/terminal/funds-modal";
import { TermModal } from "@/components/terminal/term-modal";
import { WalletPicker } from "@/components/terminal/wallet-bar";
import { enableOneClickTrading, type EnableState } from "@/lib/enable";
import { COLLATERAL, flash, MARKETS } from "@/lib/flash";
import { computePositionView, num, shortKey } from "@/lib/format";
import {
  useBalances, useBasketBalance, useLatencyLog, useMarketLimits, useMarkets,
  useOwner, usePrice, useUsdcMint, type LatencyEntry,
} from "@/lib/hooks";
import { loadSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner } from "@/lib/signer";
import { usePriceHistory } from "@/lib/use-price-history";
import {
  cancelGhostOrder, clearAuthToken, createGhostOrder, hasAuthToken,
  registerSessionWithExecutor, signInWithExecutor, useGhostOrders,
} from "@/lib/ghost";
import type { PositionMetrics } from "flash-v2";

function errMsg(e: unknown): string {
  const raw = e instanceof FlashV2Error ? e.message : e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|502 Bad Gateway/i.test(raw)) return "Can't reach the RPC right now; nothing was submitted.";
  if (/429|Too Many Requests/i.test(raw)) return "The RPC is rate-limiting. Set NEXT_PUBLIC_BASE_RPC to your own keyed RPC.";
  return raw;
}

export default function GhostTerminal() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={flash.network.baseRpc}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <Inner />
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Inner() {
  const walletCtx = useWallet();
  const anchorWallet = useAnchorWallet();
  const walletPk = walletCtx.publicKey?.toBase58() ?? null;

  const [session, setSession] = useState<LoadedSession | null>(null);
  useEffect(() => { setSession(walletPk ? loadSession(walletPk) : null); }, [walletPk]);

  const signer = useMemo(() => {
    if (!anchorWallet || !session) return null;
    if (session.authority !== anchorWallet.publicKey.toBase58()) return null;
    return makeSessionSigner(anchorWallet, session, flash.network);
  }, [anchorWallet, session]);

  const [market, setMarket] = useState<string>(MARKETS[0] ?? "SOL");
  const liveMarkets = useMarkets();
  const markets = liveMarkets ?? MARKETS;
  useEffect(() => {
    if (liveMarkets && liveMarkets.length > 0 && !liveMarkets.includes(market)) setMarket(liveMarkets[0]!);
  }, [liveMarkets, market]);

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
  const marginInUseUsd = allPositions.reduce((s, p) => s + (num(p.collateralUsdUi) ?? 0), 0);
  const markUi = price?.priceUi ?? null;
  const basketExists = Boolean(snapshot?.basketPubkey);
  const enabled = basketExists && Boolean(signer);
  const freeUsd = basketBal ? Math.max(0, basketBal.inBasketUsd - marginInUseUsd) : null;

  // refresh balances when an on-chain change lands (new basket frame)
  const basketData = snapshot?.basketData ?? null;
  useEffect(() => {
    if (!basketData) return;
    void balances.refresh();
    void refreshBasket();
  }, [basketData, balances.refresh, refreshBasket]);

  // ── modals + transient state ───────────────────────────────────────────────
  const [modal, setModal] = useState<"enable" | "funds" | "history" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [enableState, setEnableState] = useState<EnableState | null>(null);
  const [busySide, setBusySide] = useState<TradeType | null>(null);
  const [busyPos, setBusyPos] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── sign-in on connect (free signature; authorizes attach/cancel) ──────────
  const signingIn = useRef(false);
  useEffect(() => {
    const signMessage = walletCtx.signMessage;
    if (!walletPk || hasAuthToken(walletPk) || signingIn.current || !signMessage) return;
    signingIn.current = true;
    void (async () => {
      try { await signInWithExecutor(walletPk, signMessage); }
      catch (e) {
        clearAuthToken();
        setToast(`Sign-in declined. ${errMsg(e)}`);
        void walletCtx.disconnect().catch(() => undefined);
      } finally { signingIn.current = false; }
    })();
  }, [walletPk, walletCtx]);

  // ── register the scoped session with the executor (lets stops fire) ────────
  useEffect(() => {
    setRegistered(false);
    if (!session) return;
    let dead = false;
    registerSessionWithExecutor(session).then(() => !dead && setRegistered(true)).catch(() => !dead && setRegistered(false));
    return () => { dead = true; };
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── actions ────────────────────────────────────────────────────────────────
  const openPosition = useCallback(async (side: TradeType, sizeUsd: string, leverage: number) => {
    if (!signer || busySide) return;
    setBusySide(side);
    try {
      const quote = await flash.openPosition({
        inputTokenSymbol: COLLATERAL, outputTokenSymbol: market, inputAmountUi: sizeUsd,
        leverage, tradeType: side, orderType: "MARKET", owner: signer.owner,
        slippagePercentage: "0.5", ...signer.tradeFields,
      });
      if (!quote.transactionBase64) throw new Error("API returned a quote but no transaction");
      const { signature, confirmMs, sendMs } = await signer.sendTrade(quote.transactionBase64);
      addLog({ action: `${side} ${leverage}×`, chain: "er", ms: confirmMs, signature, ...(sendMs !== undefined ? { sendMs } : {}), trade: { market, side, entryUi: markUi, collateralUi: Number(sizeUsd) || null, pnlUi: null } });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusySide(null); }
  }, [signer, busySide, market, markUi, addLog]);

  const closePosition = useCallback(async (mkt: string, side: TradeType) => {
    if (!signer) return;
    const key = `${mkt}:${side}`;
    setBusyPos(key);
    try {
      const close = await flash.closePosition({ marketSymbol: mkt, side, inputUsdUi: "0", withdrawTokenSymbol: COLLATERAL, owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!close.transactionBase64) throw new Error("close-position returned no transaction");
      const { signature, confirmMs } = await signer.sendTrade(close.transactionBase64);
      addLog({ action: `CLOSE ${side}`, chain: "er", ms: confirmMs, signature, trade: { market: mkt, side, entryUi: null, collateralUi: null, pnlUi: null } });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusyPos(null); }
  }, [signer, addLog]);

  const reversePosition = useCallback(async (mkt: string, side: TradeType) => {
    if (!signer) return;
    const key = `${mkt}:${side}`;
    setBusyPos(key);
    const newSide: TradeType = side === "LONG" ? "SHORT" : "LONG";
    try {
      const built = await flash.reversePosition({ marketSymbol: mkt, side, leverage: 5, owner: signer.owner, slippagePercentage: "0.5", ...signer.tradeFields });
      if (!built.transactionBase64) throw new Error("reverse-position returned no transaction");
      const { signature, confirmMs } = await signer.sendTrade(built.transactionBase64);
      addLog({ action: `REVERSE → ${newSide}`, chain: "er", ms: confirmMs, signature, trade: { market: mkt, side: newSide, entryUi: markUi, collateralUi: null, pnlUi: null } });
    } catch (e) { setToast(errMsg(e)); }
    finally { setBusyPos(null); }
  }, [signer, markUi, addLog]);

  const runEnable = useCallback(async () => {
    if (enabling) return;
    const pk = walletCtx.publicKey;
    const signTransaction = walletCtx.signTransaction;
    if (!pk || !anchorWallet || !signTransaction) return;
    setEnabling(true);
    setModal("enable");
    try {
      const res = await enableOneClickTrading({
        wallet: { publicKey: pk, signTransaction, signAllTransactions: walletCtx.signAllTransactions },
        anchorWallet, snapshot, usdcMint, balances: { sol: balances.sol, usdc: balances.usdc },
        onStep: setEnableState, onLog: addLog,
      });
      if (res.session) setSession(res.session);
      await refresh();
      void balances.refresh();
    } catch (e) { setToast(errMsg(e)); }
    finally { setEnabling(false); }
  }, [enabling, walletCtx, anchorWallet, snapshot, usdcMint, balances, addLog, refresh]);

  const attachStop = useCallback(async (mkt: string, side: TradeType, trailingBps: number) => {
    if (!walletPk || attaching) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await createGhostOrder({ owner: walletPk, market: mkt, kind: "trailing", trailingBps, sizePctBps: 10_000, isLong: side === "LONG" });
    } catch (e) { setAttachError(errMsg(e)); }
    finally { setAttaching(false); }
  }, [walletPk, attaching]);

  const cancelStop = useCallback((pda: string) => { void cancelGhostOrder(pda).catch((e) => setToast(errMsg(e))); }, []);

  // ── derived ────────────────────────────────────────────────────────────────
  const ready = !walletPk ? "connect" : !enabled ? "enable" : (basketBal !== null && basketBal.inBasketUsd < 0.01) ? "deposit" : "ready";
  const activeMarketPositions = allPositions.filter((p) => p.marketSymbol.toUpperCase() === market.toUpperCase());
  const chartPos = activeMarketPositions[0] ?? null;
  const chartEntry = chartPos ? (num(chartPos.entryPriceUi) ?? null) : null;
  const chartSign: 1 | -1 | 0 = chartPos ? ((computePositionView(chartPos, markUi)?.pnlUsd ?? 0) >= 0 ? 1 : -1) : 0;
  const activeStops = ghostOrders.filter((o) => o.state === "active").length;

  const live = walletPk ? status === "open" : price !== null;
  const liveLabel = walletPk
    ? ({ open: "live", polling: "polling", connecting: "sync", reconnecting: "sync", closed: "off" } as const)[status]
    : price ? "live" : "sync";
  const lastErMs = entries.find((e) => e.chain === "er")?.ms ?? null;
  const priceText = price ? `$${price.priceUi.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
  const enableWallet = walletCtx.publicKey && walletCtx.signTransaction
    ? { publicKey: walletCtx.publicKey, signTransaction: walletCtx.signTransaction, signAllTransactions: walletCtx.signAllTransactions }
    : null;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg">
      <TermHeader
        market={market} markets={markets} onSelectMarket={setMarket}
        priceText={priceText} drift={drift} live={live} liveLabel={liveLabel} lastErMs={lastErMs}
        walletUsdc={balances.usdc} inBasketUsd={basketBal?.inBasketUsd ?? null}
        onConnect={() => setPickerOpen(true)}
        onOpenFunds={() => setModal("funds")} onOpenHistory={() => setModal("history")}
      />

      {/* desktop: chart+positions | ticket+stops · mobile: stacked scroll */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-edge lg:grid-cols-[1fr_360px] lg:overflow-hidden">
        <div className="grid min-h-0 grid-rows-[minmax(280px,1fr)_minmax(180px,220px)] gap-px bg-edge">
          <Panel title={`${market}/USDC · Pyth Lazer`} bodyClass="relative">
            <TermChart points={history} entryPrice={chartEntry} pnlSign={chartSign} />
          </Panel>
          <Panel title={`positions${allPositions.length ? ` · ${allPositions.length}` : ""}`} bodyClass="min-h-0">
            <PositionsPanel positions={allPositions} market={market} markUi={markUi} busyKey={busyPos} onClose={closePosition} onReverse={reversePosition} />
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <Panel title="order ticket">
            <OrderTicket market={market} ready={ready} limits={limits} freeUsd={freeUsd} busy={busySide}
              onConnect={() => setPickerOpen(true)}
              onEnable={() => void runEnable()} onDeposit={() => setModal("funds")} onOpen={openPosition} />
          </Panel>
          <Panel title="ghost stops" accent={activeStops > 0} bodyClass="min-h-0 flex-1" className="flex-1">
            <StopsPanel owner={walletPk} enabled={enabled} registered={registered} positions={allPositions}
              orders={ghostOrders} markUi={markUi} market={market} attaching={attaching} attachError={attachError}
              onAttach={attachStop} onCancel={cancelStop} />
          </Panel>
        </div>
      </main>

      {toast && (
        <button onClick={() => setToast(null)} className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 border border-short/40 bg-panel px-4 py-2.5">
          <span className="font-mono text-[11px] text-short">{toast}</span>
        </button>
      )}

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <EnableModal open={modal === "enable"} onClose={() => setModal(null)} state={enableState} enabling={enabling} onRetry={() => void runEnable()} onOpenFunds={() => setModal("funds")} />
      <FundsModal open={modal === "funds"} onClose={() => setModal(null)} wallet={enableWallet} usdcMint={usdcMint} walletUsdc={balances.usdc} inBasketUsd={basketBal?.inBasketUsd ?? null} onLog={addLog} onMoved={() => { void refresh(); void balances.refresh(); void refreshBasket(); }} />
      <HistoryModal open={modal === "history"} onClose={() => setModal(null)} entries={entries} />
    </div>
  );
}

function HistoryModal({ open, onClose, entries }: { open: boolean; onClose: () => void; entries: LatencyEntry[] }) {
  return (
    <TermModal open={open} onClose={onClose} title="session activity" width="max-w-md">
      {entries.length === 0 ? (
        <p className="font-mono text-[11px] leading-relaxed text-faint">
          Nothing yet. Every confirmed action lands here with its confirm time and on-chain signature.
        </p>
      ) : (
        <div className="flex flex-col gap-px bg-edge">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between bg-panel px-3 py-2.5">
              <span className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${e.chain === "er" ? "bg-long" : "bg-faint"}`} />
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-ink">{e.action}</span>
              </span>
              <span className="flex items-center gap-3 font-mono text-[10px] tabular-nums text-faint">
                <span className="text-dim">{e.ms} ms</span>
                <a href={`https://explorer.solana.com/tx/${e.signature}`} target="_blank" rel="noreferrer" className="text-faint underline-offset-2 hover:text-long hover:underline">
                  {shortKey(e.signature)}
                </a>
              </span>
            </div>
          ))}
        </div>
      )}
    </TermModal>
  );
}
