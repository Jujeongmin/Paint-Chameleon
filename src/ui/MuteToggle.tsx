import { useState } from "react";
import { isMuted, toggleMuted } from "../audio/sound";

/** Tiny persistent mute switch, visible in both the hub and a match. */
export function MuteToggle() {
  const [muted, setMuted] = useState(() => isMuted());

  return (
    <button
      className="mute-toggle"
      onClick={() => setMuted(toggleMuted())}
      aria-label={muted ? "소리 켜기" : "소리 끄기"}
      title={muted ? "소리 켜기" : "소리 끄기"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
