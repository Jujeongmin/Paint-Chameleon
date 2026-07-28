import { useEffect, useRef, useState } from "react";
import type { LeaderboardResult } from "../net/types";

const REFRESH_MS = 10_000;

/**
 * Polls the all-time leaderboard.
 *
 * Lives outside the thing that draws it because the board is world geometry
 * now, not a HUD panel — a component that unmounts when you look away would
 * restart the poll every time. `enabled` is what stops it running through a
 * whole match, where nothing displays it.
 *
 * `fetchLeaderboard` is deliberately NOT an effect dependency, and is read
 * through a ref instead. The offline rehearsal rig rebuilds its remote
 * functions as fresh closures on every render (`src/net/offline.ts`) — it has
 * to, because they close over the current React state. Keying the effect on
 * that identity makes it: fetch, setState, re-render, new identity, fetch
 * again — an unbounded loop that starves the render loop and freezes the
 * game. The effect owns a poll, not a subscription to a particular function.
 *
 * Failures keep the last good result rather than blanking: a scoreboard is
 * non-critical, and a retry banner on the side of a monument would be noise.
 */
export function useLeaderboard(
  fetchLeaderboard: () => Promise<LeaderboardResult>,
  enabled: boolean
): LeaderboardResult | null {
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const fetchRef = useRef(fetchLeaderboard);
  fetchRef.current = fetchLeaderboard;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = () => {
      fetchRef
        .current()
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch(() => {});
    };

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return data;
}
