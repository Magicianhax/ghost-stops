// app/app/page.tsx — the trading terminal. Reached from the landing's "Launch"
// CTAs. Everything (wallet, streams, actions) is browser state.

import GhostTerminal from "@/components/terminal/ghost-terminal";

export default function Page() {
  return <GhostTerminal />;
}
