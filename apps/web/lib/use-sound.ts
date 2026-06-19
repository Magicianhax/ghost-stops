// lib/use-sound.ts — React state for the mute toggle (Settings). Everything else
// imports playSound/unlockSound from ./sound directly; only the toggle UI needs
// reactive state. Hydrates from localStorage post-mount to avoid SSR mismatch.
import { useCallback, useEffect, useState } from "react";
import { isMuted, setMuted } from "./sound";

export function useSound(): { muted: boolean; toggle: () => void } {
  const [muted, setMutedState] = useState(false);
  useEffect(() => { setMutedState(isMuted()); }, []);
  const toggle = useCallback(() => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);
  return { muted, toggle };
}
