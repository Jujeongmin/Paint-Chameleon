/**
 * Leaderboard's testable logic — attachRanks() is the only piece that can be
 * exercised without a live $global collection (see the plan's note on why no
 * write-capable diagnostic method was added for this).
 *
 * Run: npm run check:leaderboard
 */

import { attachRanks, type LeaderboardEntry } from "../server/src/rules";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nattachRanks");
{
  check("empty list stays empty", attachRanks([]).length === 0);

  const three: LeaderboardEntry[] = [
    { account: "a", nick: "A", total: 300 },
    { account: "b", nick: "B", total: 200 },
    { account: "c", nick: "C", total: 100 },
  ];
  const ranked = attachRanks(three);
  check("ranks are 1-based and in input order", ranked.map((r) => r.rank).join(",") === "1,2,3");
  check("every field is preserved alongside the new rank", ranked[0].account === "a" && ranked[0].total === 300);

  // attachRanks must NOT re-sort — the caller (getLeaderboard) is responsible
  // for handing it pre-sorted data. Feed it deliberately out-of-order input
  // and confirm the ranks land in that same (wrong-looking) order.
  const outOfOrder: LeaderboardEntry[] = [
    { account: "low", nick: "L", total: 10 },
    { account: "high", nick: "H", total: 999 },
  ];
  const rankedOutOfOrder = attachRanks(outOfOrder);
  check(
    "does not re-sort — rank 1 goes to whichever item is first, regardless of total",
    rankedOutOfOrder[0].account === "low" && rankedOutOfOrder[0].rank === 1
  );
}

if (failures === 0) {
  console.log("\n✅ leaderboard logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
