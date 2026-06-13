// components/landing/landing-page.tsx — the "Money Gummy" marketing page,
// recreated from the Claude Design handoff. Chunky rounded panels, thick
// outlines, hard offset shadows, a ghost mascot, and a live self-updating hero
// trailing-stop chart. CTAs launch the terminal at /app. Styles in landing.css
// are scoped to .gs-landing so they never touch the terminal.

"use client";

import Link from "next/link";
import { useEffect } from "react";
import "@/app/landing.css";

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
  useEffect(() => {
    const byId = (id: string) => document.getElementById(id);
    const priceP = byId("hcPricePath");
    if (!priceP) return;
    const areaP = byId("hcAreaPath"), stopL = byId("hcStop"), entryL = byId("hcEntry"),
      dot = byId("hcDot"), peak = byId("hcPeak"), pxEl = byId("hcPx"), pnlEl = byId("hcPnl"),
      flag = byId("hcStopFlag"), evalsEl = byId("hcEvals");

    const W = 600, H = 180, N = 46, entry = 176.1, NOTIONAL = 5000;
    let price = 183.0, t = 0, evals = 4182;
    const pts: number[] = [];
    for (let i = 0; i < N; i++) pts.push(entry + 2 + (Math.random() - 0.4) * 5);
    pts[N - 1] = price;
    let stopVal = Math.max(...pts) * 0.985;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function draw() {
      t += 1;
      const center = entry * 1.04 + entry * 0.012 * Math.sin(t * 0.045);
      price += (center - price) * 0.09 + (Math.random() - 0.5) * 0.95;
      pts.push(price); if (pts.length > N) pts.shift();
      const wpeak = Math.max(...pts);
      const target = wpeak * 0.985;
      if (target > stopVal) stopVal = target;
      else if (stopVal > target + entry * 0.004) stopVal -= entry * 0.0007;
      evals += 3 + Math.floor(Math.random() * 5);
      let lo = Math.min(...pts), hi = Math.max(...pts);
      lo = Math.min(lo, stopVal, entry);
      const pad = (hi - lo) * 0.28 + 0.5; lo -= pad; hi += pad * 1.05;
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
      const qty = NOTIONAL / entry, pnlV = qty * (price - entry);
      if (pxEl) pxEl.textContent = price.toFixed(2) + " ▲";
      if (pnlEl) pnlEl.textContent = (pnlV >= 0 ? "+" : "−") + "$" + Math.abs(pnlV).toFixed(2);
      if (flag) { flag.textContent = "stop " + stopVal.toFixed(2); (flag as HTMLElement).style.top = ((sy * 178) / H).toFixed(1) + "px"; }
      if (evalsEl) evalsEl.textContent = "evals " + evals.toLocaleString() + "×";
    }
    draw();
    if (reduce) return;
    const timer = setInterval(draw, 150);
    return () => clearInterval(timer);
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
                <span className="hc-tk">S</span>
                <span><div className="hc-pair">SOL-PERP</div><div className="hc-px num" id="hcPx">182.40 ▲</div></span>
                <span className="hc-tag" id="hcPnl">+$214.30</span>
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
            <span className="pill">Flash Trade V2</span>
            <span className="pill">Solana</span>
            <span className="pill">MagicBlock Ephemeral Rollup</span>
            <span className="pill">USDC settled</span>
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
