// The order state machine — a pure TypeScript mirror of the on-chain `tick`
// in programs/ghost-stops/src/lib.rs. Used by the executor for validation and
// by the web UI for previews. All prices are RAW oracle i64 units (the SOL/USD
// Pyth Lazer feed uses 1e8 scale); integer math is division-first to match
// Rust's truncating division exactly.

export type OrderKind = "trailing" | "fixed";
export type OrderState = "active" | "fired" | "executed" | "cancelled" | "failed";

export interface EngineOrder {
  kind: OrderKind;
  isLong: boolean;
  trailingBps: number;
  highWaterMark: number;
  triggerPrice: number;
  triggerAbove: boolean;
  state: OrderState;
  expiry: number; // unix seconds, 0 = never
  firedPrice?: number;
}

/** One oracle tick. Returns a NEW order — never mutates the input. */
export function applyTick(order: EngineOrder, price: number, now: number): EngineOrder {
  if (order.state !== "active") return order;
  if (order.expiry > 0 && now > order.expiry) return { ...order, state: "cancelled" };

  if (order.kind === "fixed") {
    const crossed = order.triggerAbove ? price >= order.triggerPrice : price <= order.triggerPrice;
    return crossed ? { ...order, state: "fired", firedPrice: price } : order;
  }

  // trailing: ratchet the high-water mark, then test the stop level
  const hwm = order.isLong
    ? Math.max(order.highWaterMark, price)
    : Math.min(order.highWaterMark, price);
  const delta = Math.trunc(hwm / 10_000) * order.trailingBps;
  const stop = order.isLong ? hwm - delta : hwm + delta;
  const fired = order.isLong ? price <= stop : price >= stop;

  return fired
    ? { ...order, highWaterMark: hwm, state: "fired", firedPrice: price }
    : { ...order, highWaterMark: hwm };
}

/** Stop level implied by the current HWM — for UI overlay lines. */
export function stopLevel(order: EngineOrder): number {
  if (order.kind === "fixed") return order.triggerPrice;
  const delta = Math.trunc(order.highWaterMark / 10_000) * order.trailingBps;
  return order.isLong ? order.highWaterMark - delta : order.highWaterMark + delta;
}
