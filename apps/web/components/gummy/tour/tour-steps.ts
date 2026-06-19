// components/gummy/tour/tour-steps.ts — declarative first-run guided-tour steps.
// Each step spotlights one element (resolved by selector; the visible match wins)
// and explains it in plain language. Next/Back/Skip drive it — the tour is modal
// (the page is blocked) so a curious tap can't fire a real trade mid-tour.

export type Placement = "top" | "bottom" | "left" | "right";

export interface TourStep {
  key: string;
  target: string;   // CSS selector; the resolver picks the visible match
  title: string;
  body: string;
  placement: Placement;
}

export const TOUR_DONE_KEY = "gs-tour-done";

export const TOUR_STEPS: TourStep[] = [
  { key: "market", target: ".seg--market", placement: "bottom",
    title: "Pick a coin",
    body: "This is the market you're trading. Tap it to search SOL, BTC, ETH and more — a green pulse means trailing-stop protection is available for that coin." },
  { key: "amount", target: ".amount-wrap", placement: "right",
    title: "Your stake",
    body: "Type how much USDC to put in. This exact amount is the most you can ever lose on the trade — no more, no surprises." },
  { key: "leverage", target: ".lev-block", placement: "right",
    title: "Multiplier",
    body: "Slide to amplify the trade. 2× doubles both gains and losses; higher means bigger swings and a faster wipe-out, so start small." },
  { key: "protect", target: ".protect", placement: "right",
    title: "Your safety net",
    body: "The heart of Ghost Stops: a trailing stop that follows the price up and auto-sells if it drops the % you pick from its peak — so a win can't flip into a big loss." },
  { key: "trade", target: "[data-tour=\"trade\"]", placement: "top",
    title: "Place the bet",
    body: "Up if you think it rises, Down if you think it falls. With Protect on, your trailing stop is armed in the very same tap." },
  { key: "stops", target: "[data-tour=\"stops\"]", placement: "bottom",
    title: "Your stops",
    body: "Open this anytime to see every trailing stop you've set, watch it follow the price live, and review ones that already fired." },
  { key: "history", target: "[data-tour=\"history\"]", placement: "bottom",
    title: "Your history",
    body: "Every trade and every deposit or withdrawal, read straight from the chain — filter by All / Trades / Funds, and it shows on any device." },
  { key: "wallet", target: ".seg--wallet", placement: "bottom",
    title: "Your account",
    body: "Your ready-to-trade balance lives here. Tap to add or withdraw USDC anytime — your funds always stay yours." },
  { key: "about", target: "[data-tour=\"about\"]", placement: "bottom",
    title: "How it works",
    body: "New to perps or trailing stops? This explains everything in plain language and shows the on-chain proof. You're all set — go make your first trade." },
];
