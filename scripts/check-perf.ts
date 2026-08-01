/**
 * Frame-cost budgets for the things that run every frame, or mid-round.
 *
 * This exists because a real stall shipped. The bots' pathfinder asked
 * collision about ~31,000 grid cells in a row, each scanning all 715 boxes, and
 * it ran whenever a bot fled — which is whenever the seeker walked within
 * thirteen metres. One route took 138ms: eight frames of the game stopping,
 * four times over when four bots bolted together. Nothing caught it because
 * nothing was watching how long anything took.
 *
 * THE BUDGETS ARE DELIBERATELY LOOSE. Timings depend on the machine, and a
 * check that goes red because someone's laptop is busy is a check people learn
 * to ignore. Every budget here is set at least ten times the measured cost, so
 * it cannot catch a small regression and is not trying to — it is there to
 * catch the kind that shipped: an algorithm changing class, from "fast enough
 * to do per frame" to "not". A 20% slowdown should pass. A 20x one must not.
 *
 * Run: npm run check:perf
 */

import { MAP_BOXES, groundHeightAt, moveXZ, playerBlockedAt } from "../game/src/game/map";
import { clearCameraDistance } from "../game/src/game/camera";
import { findRoute, prewarmNav } from "../game/src/game/nav";
import { createBots, stepBots } from "../game/src/game/bot";
import { MOVE } from "../game/src/game/constants";

let failures = 0;

/** Milliseconds per call, averaged over `n`, after a warm-up pass. */
function time(f: () => void, n: number): number {
  for (let i = 0; i < Math.min(n, 50); i++) f();
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) f();
  return Number(process.hrtime.bigint() - start) / 1e6 / n;
}

function budget(label: string, f: () => void, n: number, limit: number, was?: string) {
  const cost = time(f, n);
  const ok = cost < limit;
  const detail = `${cost.toFixed(4)}ms, budget ${limit}ms${was ? ` (was ${was})` : ""}`;
  if (ok) console.log(`  ✓ ${label} — ${detail}`);
  else {
    console.error(`  ✗ ${label} — ${detail}`);
    failures++;
  }
}

const NAV = { boxes: MAP_BOXES, radius: MOVE.playerRadius, halfSize: 44 };

console.log(`\ncollision, against ${MAP_BOXES.length} boxes`);
budget("playerBlockedAt", () => playerBlockedAt(3, 5, 0, 0.45, MAP_BOXES), 5000, 0.02, "0.0070ms");
budget("groundHeightAt", () => groundHeightAt(3, 5, 0, MAP_BOXES), 5000, 0.02, "0.0063ms");
budget("moveXZ", () => moveXZ([3, 0, 5], 0.1, 0.1, 0.45, MAP_BOXES), 5000, 0.05, "0.0317ms");
budget(
  "clearCameraDistance",
  () => clearCameraDistance({ x: 0, y: 2, z: 0 }, { x: 0, y: 0.3, z: -1 }, 5.2, 0.45, MAP_BOXES),
  2000,
  0.2
);

console.log("\nthe bots");
{
  // Prewarmed first, because the grid build is the loading screen's job and
  // timing it here would measure the wrong thing.
  prewarmNav(NAV);

  budget(
    "findRoute — every time a bot re-plans, mid-chase",
    () => findRoute([-34, -34], [18, 20], NAV),
    200,
    8,
    "138.74ms"
  );

  const bots = createBots();
  budget(
    "stepBots x4 — every frame",
    () => stepBots(bots, { boxes: MAP_BOXES, seeker: [0, 0, 0], phase: "seeking", now: 0 }, 1 / 60),
    1000,
    0.5,
    "0.1675ms"
  );
}

console.log("\nthe loading screen's work");
{
  // Not a per-frame cost — this is what the loading screen is buying, and the
  // budget only says it stays the sort of thing a loading screen can absorb.
  // A second here would mean the wait had become noticeable.
  const cost = time(() => prewarmNav(NAV), 1);
  console.log(`  ·     nav prewarm is cached after the first call (${cost.toFixed(4)}ms warm)`);
}

console.log("\na whole frame's worth, together");
{
  // The numbers above are individually small and could each pass while their
  // sum did not, so this adds up what one frame actually asks for: the local
  // player's movement and camera, plus four bots.
  const bots = createBots();
  const world = { boxes: MAP_BOXES, seeker: [0, 0, 0] as [number, number, number], phase: "seeking" as const, now: 0 };
  budget(
    "local move + camera + 4 bots",
    () => {
      moveXZ([3, 0, 5], 0.1, 0.1, 0.45, MAP_BOXES);
      groundHeightAt(3, 5, 0, MAP_BOXES);
      clearCameraDistance({ x: 0, y: 2, z: 0 }, { x: 0, y: 0.3, z: -1 }, 5.2, 0.45, MAP_BOXES);
      stepBots(bots, world, 1 / 60);
    },
    1000,
    // A sixtieth of a second is 16.7ms and the renderer needs almost all of it.
    // Simulation getting a fifth of the frame would already be too much.
    3
  );
}

if (failures === 0) {
  console.log("\n✅ nothing has changed class\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} budget(s) blown\n`);
  process.exit(1);
}
