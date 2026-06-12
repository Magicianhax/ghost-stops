import { describe, expect, it } from "vitest";
import { applyTick, type EngineOrder } from "./engine.ts";

// Raw oracle i64 units (SOL/USD feed: 1e8 scale). $100.00 = 10_000_000_000.
const trailing: EngineOrder = {
  kind: "trailing",
  isLong: true,
  trailingBps: 200,
  highWaterMark: 10_000_000_000,
  triggerPrice: 0,
  triggerAbove: false,
  state: "active",
  expiry: 0,
};

describe("trailing stop (long)", () => {
  it("ratchets HWM up, never down", () => {
    expect(applyTick(trailing, 10_100_000_000, 0).highWaterMark).toBe(10_100_000_000);
    expect(applyTick(trailing, 9_950_000_000, 0).highWaterMark).toBe(10_000_000_000);
  });

  it("fires when price retraces exactly trailingBps from HWM", () => {
    const r = applyTick(trailing, 9_800_000_000, 0); // -2% = 200bps
    expect(r.state).toBe("fired");
    expect(r.firedPrice).toBe(9_800_000_000);
  });

  it("does not fire one unit above the stop", () => {
    expect(applyTick(trailing, 9_800_000_001, 0).state).toBe("active");
  });

  it("ratchet and fire use division-first integer math (matches Rust)", () => {
    // hwm not divisible by 10_000: Rust computes hwm/10_000*bps with trunc first
    const odd = { ...trailing, highWaterMark: 10_000_009_999 };
    const stop = 10_000_009_999 - Math.trunc(10_000_009_999 / 10_000) * 200;
    expect(applyTick(odd, stop, 0).state).toBe("fired");
    expect(applyTick(odd, stop + 1, 0).state).toBe("active");
  });

  it("never mutates its input", () => {
    const before = { ...trailing };
    applyTick(trailing, 9_700_000_000, 0);
    expect(trailing).toEqual(before);
  });
});

describe("trailing stop (short)", () => {
  const short = { ...trailing, isLong: false };

  it("ratchets HWM down and fires on a rise of trailingBps", () => {
    expect(applyTick(short, 9_900_000_000, 0).highWaterMark).toBe(9_900_000_000);
    const fromLow = { ...short, highWaterMark: 9_900_000_000 };
    const stop = 9_900_000_000 + Math.trunc(9_900_000_000 / 10_000) * 200;
    expect(applyTick(fromLow, stop, 0).state).toBe("fired");
    expect(applyTick(fromLow, stop - 1, 0).state).toBe("active");
  });
});

describe("fixed trigger (OCO legs)", () => {
  it("SL leg: fires when price crosses DOWN through trigger", () => {
    const sl = { ...trailing, kind: "fixed" as const, triggerPrice: 9_500_000_000, triggerAbove: false };
    expect(applyTick(sl, 9_500_000_000, 0).state).toBe("fired");
    expect(applyTick(sl, 9_500_000_001, 0).state).toBe("active");
  });

  it("TP leg: fires when price crosses UP through trigger", () => {
    const tp = { ...trailing, kind: "fixed" as const, triggerPrice: 10_500_000_000, triggerAbove: true };
    expect(applyTick(tp, 10_500_000_000, 0).state).toBe("fired");
    expect(applyTick(tp, 10_499_999_999, 0).state).toBe("active");
  });
});

describe("lifecycle guards", () => {
  it("expires instead of firing", () => {
    const r = applyTick({ ...trailing, expiry: 10 }, 9_000_000_000, 11);
    expect(r.state).toBe("cancelled");
  });

  it("does not expire at exactly expiry", () => {
    const r = applyTick({ ...trailing, expiry: 10 }, 10_000_000_000, 10);
    expect(r.state).toBe("active");
  });

  it("non-active orders pass through untouched", () => {
    for (const state of ["fired", "executed", "cancelled", "failed"] as const) {
      expect(applyTick({ ...trailing, state }, 1, 0)).toEqual({ ...trailing, state });
    }
  });
});
