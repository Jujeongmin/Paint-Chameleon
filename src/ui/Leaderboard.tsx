import { useEffect, useState } from "react";
import type { LeaderboardResult, RankedLeaderboardEntry } from "../net/types";

interface Props {
  account: string;
  fetchLeaderboard: () => Promise<LeaderboardResult>;
}

const REFRESH_MS = 10_000;

function Row({ entry, account }: { entry: RankedLeaderboardEntry; account: string }) {
  return (
    <div className="leaderboard-row">
      <span className="leaderboard-rank">{entry.rank}</span>
      <span
        className="leaderboard-name"
        style={{ color: entry.account === account ? "var(--accent)" : undefined }}
      >
        {entry.nick}
        {entry.account === account ? " (나)" : ""}
      </span>
      <span className="leaderboard-total">{entry.total}</span>
    </div>
  );
}

/** Hub-only panel — top 10 all-time scores, plus your own rank if you're outside it. */
export function Leaderboard({ account, fetchLeaderboard }: Props) {
  const [data, setData] = useState<LeaderboardResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchLeaderboard()
        .then((result) => {
          if (!cancelled) setData(result);
        })
        // Keep showing the last good data on failure; leaderboard is
        // non-critical, a retry banner would be noise.
        .catch(() => {});
    };

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchLeaderboard]);

  return (
    <div className="leaderboard">
      <div className="leaderboard-heading">리더보드</div>
      {!data || data.top.length === 0 ? (
        <div className="leaderboard-empty">아직 기록이 없습니다</div>
      ) : (
        <>
          {data.top.map((entry) => (
            <Row key={entry.account} entry={entry} account={account} />
          ))}
          {data.me && (
            <>
              <div className="leaderboard-divider" />
              <Row entry={data.me} account={account} />
            </>
          )}
        </>
      )}
    </div>
  );
}
