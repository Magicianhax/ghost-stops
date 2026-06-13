// components/landing/landing-page.tsx — the "Money Gummy" marketing page,
// recreated from the Claude Design handoff. Chunky rounded panels, thick
// outlines, hard offset shadows, a ghost mascot, and a live self-updating hero
// trailing-stop chart. CTAs launch the terminal at /app. Styles in landing.css
// are scoped to .gs-landing so they never touch the terminal.

"use client";

import Link from "next/link";
import { useEffect } from "react";
import { flash } from "@/lib/flash";
import { TokenLogo } from "@/components/token-logo";
import "@/app/landing.css";

function UsdcMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden style={{ display: "block" }}>
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path d="M20.5 18.6c0-2.4-1.45-3.23-4.35-3.58-2.07-.27-2.49-.82-2.49-1.78s.69-1.6 2.07-1.6c1.24 0 1.93.41 2.27 1.45a.52.52 0 0 0 .49.35h1.1a.48.48 0 0 0 .48-.5v-.06a3.43 3.43 0 0 0-3.04-2.81V8.9a.49.49 0 0 0-.48-.55h-1.04a.49.49 0 0 0-.48.55v1.15c-2.07.28-3.38 1.66-3.38 3.38 0 2.28 1.38 3.16 4.28 3.51 1.93.34 2.55.76 2.55 1.85s-.96 1.85-2.27 1.85c-1.79 0-2.41-.76-2.62-1.79a.5.5 0 0 0-.48-.41h-1.18a.48.48 0 0 0-.48.5v.05a3.6 3.6 0 0 0 3.45 3.09v1.16a.49.49 0 0 0 .48.55h1.04a.49.49 0 0 0 .48-.55v-1.16c2.07-.35 3.45-1.8 3.45-3.65Z" fill="#fff" />
      <path d="M12.6 24.9c-5.38-1.93-8.14-7.93-6.14-13.24a10.2 10.2 0 0 1 6.14-6.14c.28-.14.42-.34.42-.69V3.86c0-.28-.14-.48-.42-.55-.07 0-.2 0-.28.07a13.1 13.1 0 0 0 0 24.65c.28.13.55 0 .62-.28.07-.07.07-.14.07-.28v-.96c0-.27-.2-.55-.41-.62Zm6.83-21.5c-.28-.14-.55 0-.62.27-.07.07-.07.14-.07.28v.96c0 .28.2.55.41.62 5.38 1.93 8.14 7.93 6.14 13.24a10.2 10.2 0 0 1-6.14 6.14c-.28.14-.42.34-.42.69v.96c0 .28.14.48.42.55.07 0 .2 0 .28-.07a13.1 13.1 0 0 0 0-24.65Z" fill="#fff" />
    </svg>
  );
}

function SolanaMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 398 312" aria-hidden style={{ display: "block" }}>
      <defs><linearGradient id="solg" x1="360" y1="-37" x2="141" y2="383" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#00FFA3" /><stop offset="1" stopColor="#DC1FFF" /></linearGradient></defs>
      <path fill="url(#solg)" d="M64 237a13 13 0 0 1 9-4h317c6 0 9 7 5 11l-63 63a13 13 0 0 1-9 4H6c-6 0-9-7-5-11l63-63Z" />
      <path fill="url(#solg)" d="M64 1a13 13 0 0 1 9-4h317c6 0 9 7 5 11l-63 63a13 13 0 0 1-9 4H6c-6 0-9-7-5-11L64 1Z" />
      <path fill="url(#solg)" d="M334 118a13 13 0 0 0-9-4H8c-6 0-9 7-5 11l63 63a13 13 0 0 0 9 4h317c6 0 9-7 5-11l-63-63Z" />
    </svg>
  );
}

function Ghost({ size = 32, accent = false, cheeks = true, className = "" }: { size?: number; accent?: boolean; cheeks?: boolean; className?: string }) {
  return (
    <svg className={`ghost ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path className="gh-body" d="M18 52 a32 32 0 0 1 64 0 L82 86 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 Z" style={accent ? { fill: "var(--accent)" } : undefined} />
      <ellipse className="gh-eye" cx="40" cy="50" rx="5.5" ry="7" />
      <ellipse className="gh-eye" cx="60" cy="50" rx="5.5" ry="7" />
      {cheeks && <circle className="gh-cheek" cx="31" cy="62" r="4.2" />}
      {cheeks && <circle className="gh-cheek" cx="69" cy="62" r="4.2" />}
    </svg>
  );
}

export default function LandingPage() {
  // Hero chart driven by the REAL live SOL price (Flash Trade's Pyth Lazer
  // oracle), with a trailing stop ratcheting off the real highs. No mock walk:
  // the line, PnL, and stop all move with the actual market.
  useEffect(() => {
    const byId = (id: string) => document.getElementById(id);
    const priceP = byId("hcPricePath");
    if (!priceP) return;
    const areaP = byId("hcAreaPath"), stopL = byId("hcStop"), entryL = byId("hcEntry"),
      dot = byId("hcDot"), peak = byId("hcPeak"), pairEl = byId("hcPair"), pxEl = byId("hcPx"), pnlEl = byId("hcPnl"),
      flag = byId("hcStopFlag"), evalsEl = byId("hcEvals");
    const W = 600, H = 180, N = 46, NOTIONAL = 5000;
    let entry = 0, price = 0, evals = 0, stopVal = 0;
    const pts: number[] = [];
    let dead = false;

    const render = () => {
      if (pts.length < 2) return;
      const wpeak = Math.max(...pts);
      let lo = Math.min(...pts, stopVal, entry || pts[0]!), hi = Math.max(...pts);
      const pad = (hi - lo) * 0.28 + Math.max(hi * 0.001, 0.01); lo -= pad; hi += pad * 1.05;
      const Y = (v: number) => (1 - (v - lo) / (hi - lo)) * H;
      const X = (i: number) => 10 + (i / (N - 1)) * (W - 20);
      let d = ""; const n = pts.length;
      for (let i = 0; i < n; i++) d += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(pts[i]!).toFixed(1) + " ";
      priceP!.setAttribute("d", d);
      areaP?.setAttribute("d", d + "L " + X(n - 1).toFixed(1) + " " + H + " L " + X(0) + " " + H + " Z");
      const sy = Y(stopVal); stopL?.setAttribute("y1", sy.toFixed(1)); stopL?.setAttribute("y2", sy.toFixed(1));
      const ey = Y(entry); entryL?.setAttribute("y1", ey.toFixed(1)); entryL?.setAttribute("y2", ey.toFixed(1));
      dot?.setAttribute("cx", X(n - 1).toFixed(1)); dot?.setAttribute("cy", Y(price).toFixed(1));
      const pi = pts.indexOf(wpeak); peak?.setAttribute("cx", X(pi).toFixed(1)); peak?.setAttribute("cy", Y(wpeak).toFixed(1));
      const pnlV = (NOTIONAL / entry) * (price - entry);
      if (pxEl) pxEl.textContent = price.toFixed(2) + (pnlV >= 0 ? " ▲" : " ▼");
      if (pnlEl) pnlEl.textContent = (pnlV >= 0 ? "+" : "−") + "$" + Math.abs(pnlV).toFixed(2);
      if (flag) { flag.textContent = "stop " + stopVal.toFixed(2); (flag as HTMLElement).style.top = ((sy * 178) / H).toFixed(1) + "px"; }
      if (evalsEl) evalsEl.textContent = "evals " + evals.toLocaleString() + "×";
    };

    const poll = async () => {
      try {
        const p = await flash.price("SOL");
        if (dead) return;
        price = p.priceUi;
        if (entry === 0) { entry = price * 0.985; for (let i = 0; i < N; i++) pts.push(price); stopVal = price * 0.985; if (pairEl) pairEl.textContent = "SOL-PERP"; }
        pts.push(price); if (pts.length > N) pts.shift();
        const target = Math.max(...pts) * 0.985; // 1.5% trail off the real peak
        if (target > stopVal) stopVal = target;
        evals += 10; // ~10 on-chain evaluations/second
        render();
      } catch { /* keep last; next poll retries */ }
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => { dead = true; clearInterval(timer); };
  }, []);

  return (
    <div className="gs-landing" id="top">
      {/* NAV */}
      <nav>
        <div className="wrap">
          <div className="nav-in">
            <Link className="brand" href="#top">
              <Ghost size={32} cheeks />
              Ghost Stops
            </Link>
            <div className="nav-links">
              <a href="#how">How it works</a>
              <a href="#features">Features</a>
              <a href="#trail">Trailing</a>
            </div>
            <div className="nav-cta">
              <Link className="btn btn--green" href="/app">Launch app →</Link>
            </div>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <svg className="decor float" style={{ top: "30px", right: "6%", width: "64px" }} viewBox="0 0 100 100" aria-hidden>
          <path className="gh-body" d="M18 52 a32 32 0 0 1 64 0 L82 86 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 Z" style={{ fill: "var(--accent)" }} />
          <ellipse className="gh-eye" cx="40" cy="50" rx="5.5" ry="7" />
          <ellipse className="gh-eye" cx="60" cy="50" rx="5.5" ry="7" />
        </svg>
        <div className="wrap">
          <div className="hero-grid">
            <div>
              <span className="eyebrow"><span className="dot" />Triggers run on-chain · ~10× per second</span>
              <h1>Trailing stops that <span className="hl">actually&nbsp;fire</span>.<br />No babysitting <span className="hl-y">required</span>.</h1>
              <p className="lead">Ghost Stops bolts advanced order types — trailing stops, OCO, brackets — onto Flash Trade perps. Your stop trails the price <b style={{ color: "var(--ink)" }}>on-chain</b>, evaluated ten times a second, and closes you out in about a second. No fees. No private server. You keep custody the whole time.</p>
              <div className="hero-cta">
                <Link className="btn btn--green btn--lg" href="/app">Launch the terminal</Link>
                <a className="btn btn--ghost btn--lg" href="#trail">See how trailing works</a>
              </div>
              <div className="hero-note"><Ghost size={18} cheeks={false} /> Non-custodial · one signature to enable one-click trading</div>
            </div>

            {/* live chart card */}
            <div className="hero-card">
              <svg className="decor float2" style={{ top: "-26px", left: "-22px", width: "52px" }} viewBox="0 0 100 100" aria-hidden>
                <path className="gh-body" d="M18 52 a32 32 0 0 1 64 0 L82 86 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 Z" />
                <ellipse className="gh-eye" cx="40" cy="50" rx="5.5" ry="7" />
                <ellipse className="gh-eye" cx="60" cy="50" rx="5.5" ry="7" />
                <circle className="gh-cheek" cx="31" cy="62" r="4.2" /><circle className="gh-cheek" cx="69" cy="62" r="4.2" />
              </svg>
              <div className="hc-top">
                <span className="hc-tk" style={{ overflow: "hidden", background: "var(--panel-2)", padding: 0 }}><TokenLogo symbol="SOL" size={30} /></span>
                <span><div className="hc-pair" id="hcPair">SOL-PERP</div><div className="hc-px num" id="hcPx">live · Pyth Lazer</div></span>
                <span className="hc-tag" id="hcPnl">—</span>
              </div>
              <div className="hc-chart">
                <svg viewBox="0 0 600 180" preserveAspectRatio="none" width="100%" height="178">
                  <defs>
                    <linearGradient id="hcArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#5cf0a8" stopOpacity="0.28" />
                      <stop offset="1" stopColor="#5cf0a8" stopOpacity="0" />
                    </linearGradient>
                    <filter id="hcGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <path id="hcAreaPath" d="" fill="url(#hcArea)" vectorEffect="non-scaling-stroke" />
                  <line id="hcEntry" x1="0" y1="150" x2="600" y2="150" stroke="var(--muted)" strokeWidth="2" strokeDasharray="2 8" opacity="0.5" vectorEffect="non-scaling-stroke" />
                  <line id="hcStop" x1="0" y1="120" x2="600" y2="120" stroke="var(--accent)" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <path id="hcPricePath" d="" fill="none" stroke="#5cf0a8" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" filter="url(#hcGlow)" vectorEffect="non-scaling-stroke" />
                  <circle id="hcPeak" cx="520" cy="42" r="6" fill="#5cf0a8" stroke="var(--outline)" strokeWidth="2.5" />
                  <circle id="hcDot" cx="590" cy="34" r="6.5" fill="#5cf0a8" stroke="var(--outline)" strokeWidth="2.5" />
                </svg>
                <span className="hc-stopflag num" id="hcStopFlag">stop 179.66</span>
              </div>
              <div className="hc-foot"><span className="gj">⚡ stop trailing · 1.5%</span><span className="num" id="hcEvals">evals 4,182×</span></div>
            </div>
          </div>
        </div>
      </header>

      {/* TRUST */}
      <section className="trust">
        <div className="wrap">
          <div className="trust-in">
            <span>Built on</span>
            <span className="pill"><SolanaMark size={15} />Solana</span>
            <span className="pill"><UsdcMark size={16} />USDC settled</span>
            <span className="pill">Flash Trade V2</span>
            <span className="pill">MagicBlock Ephemeral Rollup</span>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="sec" id="features">
        <div className="wrap">
          <div className="sec-tag">Why Ghost Stops</div>
          <div className="sec-title">Order types that live <span style={{ color: "var(--green)" }}>on-chain</span></div>
          <p className="sec-sub">No bot you have to trust, no server that can go down at 3am. The trigger logic is evaluated inside a rollup against live oracle prices.</p>
          <div className="feat-grid">
            <div className="feat">
              <div className="feat-ic" style={{ background: "var(--green)" }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--ongreen)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2-7 4 14 2-7h4" /></svg></div>
              <h3>~10 checks per second</h3>
              <p>Every order is evaluated against live oracle prices about ten times a second inside the Ephemeral Rollup — fast enough to catch the wick.</p>
              <span className="chip">on-chain triggers</span>
            </div>
            <div className="feat">
              <div className="feat-ic" style={{ background: "var(--accent)" }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--onaccent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></div>
              <h3>No fees, no server</h3>
              <p>The rollup runs the conditions for free and there&apos;s no private backend in the loop. Nothing to subscribe to, nothing to babysit.</p>
              <span className="chip">zero trigger fees</span>
            </div>
            <div className="feat">
              <div className="feat-ic" style={{ background: "#d6fff0" }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--outline)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z" /><path d="M9 12l2 2 4-4" /></svg></div>
              <h3>You keep custody</h3>
              <p>One signature sets up a scoped, revocable session key. It can place and close trades — nothing else — so funds never leave your control.</p>
              <span className="chip">non-custodial session key</span>
            </div>
            <div className="feat">
              <div className="feat-ic" style={{ background: "var(--pink)" }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3a0f24" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h10M4 12h16M4 17h7" /><circle cx="18" cy="7" r="2.4" /><circle cx="15" cy="17" r="2.4" /></svg></div>
              <h3>Advanced orders</h3>
              <p>Trailing stops, OCO and bracket orders on top of plain market trades — with optional take-profit and stop-loss baked into the fill.</p>
              <span className="chip">trailing · OCO · brackets</span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW */}
      <section className="sec" id="how">
        <div className="wrap">
          <div className="sec-tag">Three taps to protected</div>
          <div className="sec-title">From wallet to watched in seconds</div>
          <div className="steps">
            <div className="step"><div className="step-n">1</div><h4>Connect</h4><p>Pick a wallet and sign a message to prove ownership. It&apos;s free — no transaction, no gas.</p></div>
            <div className="step"><div className="step-n">2</div><h4>Enable one-click</h4><p>A single signature spins up your trading account and a scoped session key. After that, trades need no popups.</p></div>
            <div className="step"><div className="step-n">3</div><h4>Protect</h4><p>Open a position, attach a Ghost Stop, and watch it trail live. It fires and closes you out automatically.</p></div>
          </div>
        </div>
      </section>

      {/* TRAIL EXPLAINER */}
      <section className="sec" id="trail">
        <div className="wrap">
          <div className="sec-tag">The magic bit</div>
          <div className="sec-title">It follows your highs, then catches your fall</div>
          <div className="trail-card">
            <svg viewBox="0 0 420 260" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <defs><linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5cf0a8" stopOpacity="0.25" /><stop offset="1" stopColor="#5cf0a8" stopOpacity="0" /></linearGradient></defs>
              <path d="M10 210 L90 210 L90 168 L170 168 L170 120 L250 120 L250 86 L330 86 L330 120 L410 120" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinejoin="round" strokeDasharray="2 9" strokeLinecap="round" />
              <path d="M10 196 C 50 150, 70 150, 90 154 C 130 130, 150 104, 170 106 C 210 96, 230 70, 250 72 C 290 60, 310 58, 330 72 C 360 96, 380 150, 410 168" fill="none" stroke="#d6fff0" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx="330" cy="72" r="9" fill="var(--green)" stroke="var(--outline)" strokeWidth="3" />
              <circle cx="410" cy="120" r="10" fill="var(--accent)" stroke="var(--outline)" strokeWidth="3" />
              <text x="318" y="52" fill="var(--green)" fontFamily="Baloo 2" fontWeight="800" fontSize="15">peak</text>
              <text x="356" y="142" fill="var(--accent)" fontFamily="Baloo 2" fontWeight="800" fontSize="15">fires ⚡</text>
            </svg>
            <div className="trail-list">
              <div className="trail-item"><span className="trail-key tk-px" /><div><b>Price climbs.</b><p>You&apos;re in a winning position and the market keeps printing new highs.</p></div></div>
              <div className="trail-item"><span className="trail-key tk-peak" /><div><b>The peak gets remembered.</b><p>The stop ratchets up to follow each new high — it never moves backward.</p></div></div>
              <div className="trail-item"><span className="trail-key tk-stop" /><div><b>It fires on the fall.</b><p>The moment price drops your trail distance below the peak, the stop fires on-chain and closes the position — locking in the run.</p></div></div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="cta">
        <div className="wrap">
          <div className="cta-card">
            <svg className="decor float" style={{ top: "24px", left: "8%", width: "56px" }} viewBox="0 0 100 100" aria-hidden>
              <path className="gh-body" d="M18 52 a32 32 0 0 1 64 0 L82 86 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 Z" />
              <ellipse className="gh-eye" cx="40" cy="50" rx="5.5" ry="7" /><ellipse className="gh-eye" cx="60" cy="50" rx="5.5" ry="7" />
              <circle className="gh-cheek" cx="31" cy="62" r="4.2" /><circle className="gh-cheek" cx="69" cy="62" r="4.2" />
            </svg>
            <svg className="decor float2" style={{ bottom: "18px", right: "9%", width: "46px" }} viewBox="0 0 100 100" aria-hidden>
              <path className="gh-body" d="M18 52 a32 32 0 0 1 64 0 L82 86 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 Z" style={{ fill: "var(--accent)" }} />
              <ellipse className="gh-eye" cx="40" cy="50" rx="5.5" ry="7" /><ellipse className="gh-eye" cx="60" cy="50" rx="5.5" ry="7" />
            </svg>
            <h2>Stop watching charts.<br />Let the ghost do it.</h2>
            <p>Spin up the terminal, arm a trailing stop, and go live your life. It&apos;ll close you out at the right moment.</p>
            <Link className="btn btn--accent btn--lg" href="/app">Launch Ghost Stops →</Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="wrap">
          <div className="foot-in">
            <Link className="brand" href="#top"><Ghost size={28} cheeks={false} /> Ghost Stops</Link>
            <div className="foot-links">
              <Link href="/app">Terminal</Link>
              <a href="#how">How it works</a>
              <a href="#features">Features</a>
            </div>
            <div className="foot-note">A demo interface concept. Perpetual futures and leverage are high-risk — trailing stops reduce but do not eliminate the risk of loss. Not financial advice.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
