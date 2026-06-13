// app/page.tsx — the single route. Hands off to the client terminal shell;
// everything (wallet, streams, actions) is browser state by design.

import GhostTerminal from "@/components/terminal/ghost-terminal";

export default function Page() {
  return <GhostTerminal />;
}
