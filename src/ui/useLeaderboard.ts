import { useEffect, useState } from "react";
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
 * Failures keep the last good result rather than blanking: a scoreboard is
 * non-critical, and a retry banner on the side of a monument would be noise.
 */
export function useLeaderboard(
  fetchLeaderboard: () => Promise<LeaderboardResult>,
  enabled: boolean
): LeaderboardResult | null {
  const [data, setData] = useState<LeaderboardResult | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = () => {
      fetchLeaderboard()
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
  }, [fetchLeaderboard, enabled]);

  return data;
}
