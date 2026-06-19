// lib/sound.ts — tiny Web Audio sound system: synthesized tones, NO asset files.
// One shared AudioContext, unlocked on the first user gesture (so there's never
// an autoplay-policy violation), with a persisted mute toggle. A module singleton
// so non-React callers — e.g. the order card's high-water-mark ratchet effect —
// can play a beat without prop-drilling a context. SSR-safe (guards on window).

export type SoundId =
  | "open" | "close" | "reverse"
  | "attach" | "trail" | "fire" | "executed"
  | "notice" | "error";

const MUTE_KEY = "gs-muted";
let ctx: AudioContext | null = null;
let muted = false;
let hydrated = false;

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try { muted = window.localStorage.getItem(MUTE_KEY) === "1"; } catch { /* default unmuted */ }
}

export function isMuted(): boolean { hydrate(); return muted; }

export function setMuted(v: boolean): void {
  muted = v;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  }
}

/** Create/resume the shared AudioContext. Call from the FIRST user gesture.
 *  Idempotent — safe to call on every pointerdown. */
export function unlockSound(): void {
  if (typeof window === "undefined") return;
  hydrate();
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* audio unavailable — stays silent */ }
}

interface Note { f: number; type?: OscillatorType; t: number; d: number; g?: number }

// Distinct character per beat. Quietest/shortest for the ones that fire often
// (trail, notice). Frequencies are a loose pentatonic so overlaps don't clash.
const RECIPES: Record<SoundId, Note[]> = {
  open:     [{ f: 523, t: 0, d: 0.09 }, { f: 784, t: 0.07, d: 0.12 }],
  close:    [{ f: 392, type: "sine", t: 0, d: 0.16, g: 0.5 }],
  reverse:  [{ f: 660, t: 0, d: 0.07 }, { f: 440, t: 0.06, d: 0.07 }, { f: 660, t: 0.12, d: 0.1 }],
  attach:   [{ f: 988, t: 0, d: 0.1 }],
  trail:    [{ f: 1320, type: "sine", t: 0, d: 0.035, g: 0.22 }],
  fire:     [{ f: 880, type: "square", t: 0, d: 0.1, g: 0.32 }, { f: 1175, type: "square", t: 0.09, d: 0.16, g: 0.32 }],
  executed: [{ f: 523, t: 0, d: 0.2, g: 0.4 }, { f: 659, t: 0.02, d: 0.22, g: 0.4 }, { f: 784, t: 0.04, d: 0.24, g: 0.4 }],
  notice:   [{ f: 660, type: "sine", t: 0, d: 0.08, g: 0.42 }],
  error:    [{ f: 180, type: "sawtooth", t: 0, d: 0.16, g: 0.28 }],
};

let lastTrail = 0;

export function playSound(id: SoundId): void {
  hydrate();
  if (muted || !ctx || ctx.state !== "running") return;
  if (id === "trail") {
    const now = ctx.currentTime * 1000;
    if (now - lastTrail < 130) return; // throttle the high-frequency ratchet tick
    lastTrail = now;
  }
  const t0 = ctx.currentTime;
  for (const n of RECIPES[id]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type ?? "triangle";
    osc.frequency.value = n.f;
    const peak = (n.g ?? 0.6) * 0.6; // master scale — never harsh
    const start = t0 + n.t;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + n.d + 0.03);
  }
}
