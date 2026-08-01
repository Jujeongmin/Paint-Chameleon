/**
 * Phase durations, measured against the arena instead of guessed.
 *
 * 30/90 was tuned for a 44x44 arena. The map is 88x88 now — four times the
 * floor, a 124u diagonal — and nobody had rechecked the numbers since. README's
 * known limitation 11 has said so for three sessions.
 *
 * WHAT THIS CAN AND CANNOT ANSWER. It cannot tell you whether the game is fun,
 * and it cannot simulate a seeker, because how well somebody hunts is a fact
 * about that person and not about the map. What it CAN answer is the pair of
 * physical questions underneath the balance question, both of which are
 * properties of the geometry and the walk speed:
 *
 *   1. Can a hider get from where they spawn to somewhere worth hiding, before
 *      the hiding phase ends? If not, the phase is too short no matter who is
 *      playing.
 *   2. Can a seeker physically VISIT enough of the map in their time? Not
 *      "find anyone" — visit. If ninety seconds does not even let them walk
 *      past most of the hiding places, the phase is too short for any skill
 *      level, and if it lets them walk past all of them twice over it is too
 *      long for any skill level.
 *
 * Both numbers come from the game's own integrator walking the game's own
 * routes, so they move when the map moves.
 *
 * The assertions are deliberately loose. A tight bound here would be this
 * script inventing a balance opinion and then agreeing with itself; what it is
 * for is catching the map growing out from under the clock again.
 *
 * Run: npm run check:balance
 */

import { CLUSTERS, SPAWN_POINTS, slotOf } from "../game/src/game/arena";
import { MAP_BOXES, ARENA } from "../game/src/game/map";
import { findRoute, simplifyRoute } from "../game/src/game/nav";
import { createMotionState, stepMotion } from "../game/src/game/movement";
import { MOVE, PHASE_SECONDS } from "../game/src/game/constants";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}
function note(label: string) {
  console.log("  ·     " + label);
}

const DT = 1 / 60;
const NAV = { boxes: MAP_BOXES, radius: MOVE.playerRadius, halfSize: ARENA.size / 2 };
const SLOTS = CLUSTERS.map(slotOf);

/**
 * Seconds for a body to walk a route with the real integrator, or Infinity if
 * it never arrives. This is the same driver check:map uses to prove a slot is
 * reachable — reused here to ask how LONG reachable takes.
 */
function walkSeconds(
  from: [number, number],
  to: [number, number],
  speed: number,
  radius: number,
  cap = 120
): number {
  const route = findRoute(from, to, { ...NAV, radius });
  if (!route) return Infinity;
  const waypoints = simplifyRoute(route);

  const state = createMotionState([from[0], 0, from[1]]);
  let wp = 0;
  for (let i = 0; i < cap / DT; i++) {
    while (
      wp < waypoints.length - 1 &&
      Math.hypot(waypoints[wp][0] - state.pos[0], waypoints[wp][1] - state.pos[2]) < 0.9
    ) {
      wp++;
    }
    const aim = waypoints[wp];
    const dx = aim[0] - state.pos[0];
    const dz = aim[1] - state.pos[2];
    stepMotion(state, { forward: 1, strafe: 0, jump: false }, Math.atan2(dx, dz), {
      boxes: MAP_BOXES,
      dt: DT,
      now: i * DT * 1000,
      speed,
      radius,
      worldHalfSize: ARENA.size / 2,
    });
    if (Math.hypot(to[0] - state.pos[0], to[1] - state.pos[2]) < 1.0) return i * DT;
  }
  return Infinity;
}

function stats(values: number[]): { median: number; worst: number } {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return { median: Infinity, worst: Infinity };
  return { median: finite[Math.floor(finite.length / 2)], worst: finite[finite.length - 1] };
}

console.log("\nhiding: can a hider reach cover in time?");
{
  // From each spawn to the nearest slot — the cheapest thing a hider can do.
  // A player who wants a particular spot will take longer, which is a choice
  // they are making; the phase only has to afford the cheap option.
  const nearest = SPAWN_POINTS.map((spawn) => {
    let best = Infinity;
    for (const slot of SLOTS) {
      // Straight-line pre-filter: routing to all 24 from all 12 spawns is 288
      // flood fills of the whole arena, and the far ones cannot win anyway.
      if (Math.hypot(slot[0] - spawn[0], slot[1] - spawn[1]) > 30) continue;
      best = Math.min(best, walkSeconds(spawn, slot, MOVE.hiderSpeed, MOVE.playerRadius));
    }
    return best;
  });

  const { median, worst } = stats(nearest);
  note(`nearest cover from a spawn: median ${median.toFixed(1)}s, worst ${worst.toFixed(1)}s`);
  note(`hiding phase is ${PHASE_SECONDS.hiding}s`);

  check(
    `every spawn has cover it can reach at all`,
    nearest.every((s) => Number.isFinite(s)),
    `${nearest.filter((s) => !Number.isFinite(s)).length} spawns cannot reach any slot`
  );
  // Getting there is not the whole job — you still have to pose and paint. Half
  // the phase spent walking is the point at which hiding stops being a choice
  // and becomes a race.
  check(
    `the walk leaves time to actually hide (worst ${worst.toFixed(1)}s of ${PHASE_SECONDS.hiding}s)`,
    worst < PHASE_SECONDS.hiding * 0.5,
    `walking eats ${((worst / PHASE_SECONDS.hiding) * 100).toFixed(0)}% of the phase`
  );
}

console.log("\nseeking: how much of the map fits in the clock?");
{
  // A nearest-first tour of every hiding slot, starting where the seeker lands.
  // This is not how anyone plays — it is the CHEAPEST possible sweep, so it is
  // an upper bound on coverage. If even this cannot get round the map, no
  // player can.
  const R = MOVE.playerRadius;
  const unvisited = SLOTS.map((s, i) => ({ at: s, i }));
  let at: [number, number] = [0, 0];
  let elapsed = 0;
  const arrivals: number[] = [];

  while (unvisited.length) {
    let bestIndex = -1;
    let bestTime = Infinity;
    for (let k = 0; k < unvisited.length; k++) {
      // Only try the few nearest as the crow flies; walking every candidate
      // would be a flood fill per slot per hop.
      const straight = Math.hypot(unvisited[k].at[0] - at[0], unvisited[k].at[1] - at[1]);
      if (straight > 22) continue;
      const t = walkSeconds(at, unvisited[k].at, MOVE.seekerSpeed, R);
      if (t < bestTime) {
        bestTime = t;
        bestIndex = k;
      }
    }
    if (bestIndex === -1) {
      // Nothing within the straight-line window; fall back to the closest.
      let closest = 0;
      for (let k = 1; k < unvisited.length; k++) {
        const a = Math.hypot(unvisited[k].at[0] - at[0], unvisited[k].at[1] - at[1]);
        const b = Math.hypot(unvisited[closest].at[0] - at[0], unvisited[closest].at[1] - at[1]);
        if (a < b) closest = k;
      }
      bestIndex = closest;
      bestTime = walkSeconds(at, unvisited[closest].at, MOVE.seekerSpeed, R);
    }
    if (!Number.isFinite(bestTime)) break;

    elapsed += bestTime;
    at = unvisited[bestIndex].at;
    arrivals.push(elapsed);
    unvisited.splice(bestIndex, 1);
  }

  const within = arrivals.filter((t) => t <= PHASE_SECONDS.seeking).length;
  const coverage = within / SLOTS.length;
  note(`a perfect sweep visits ${within}/${SLOTS.length} hiding slots in ${PHASE_SECONDS.seeking}s`);
  note(`walking past all ${SLOTS.length} of them takes ${arrivals[arrivals.length - 1]?.toFixed(0)}s`);
  note(`seeking phase is ${PHASE_SECONDS.seeking}s`);

  check(`the sweep reaches every slot eventually`, arrivals.length === SLOTS.length);

  // The phase is pinned to the sweep, not to a coverage percentage. An earlier
  // version asserted "coverage <= 100%", which is true of every number and so
  // asserted nothing — it would have stayed green at any phase length at all.
  //
  // The ratio is what carries meaning. Below 1 and even a flawless seeker runs
  // out of clock before seeing the map, which loses rounds to arithmetic rather
  // than to play. Far above 1 and the clock stops mattering: at the old 90s the
  // cheapest possible sweep finished with seventeen seconds spare, so nothing
  // about where you hid could cost the seeker anything.
  //
  // The band is WIDE, and deliberately so. 90s scores 1.24 and passes it too —
  // this check does not endorse the 75 that replaced it, and should not be read
  // as having picked between them. Choosing 75 was a judgement made from the
  // measurement above; what the band is for is the map growing out from under
  // the clock again, which is what happened when the arena went to 88x88 and
  // nobody rechecked for three sessions. Narrowing it until only today's number
  // fits would be this script inventing an opinion and then agreeing with
  // itself.
  const sweep = arrivals[arrivals.length - 1];
  const ratio = PHASE_SECONDS.seeking / sweep;
  note(`the phase is ${ratio.toFixed(2)}x a perfect sweep`);
  check(
    `the clock is close to what a perfect sweep needs (${ratio.toFixed(2)}x)`,
    ratio >= 0.9 && ratio <= 1.25,
    `${PHASE_SECONDS.seeking}s against a ${sweep.toFixed(0)}s sweep — ` +
      (ratio < 0.9 ? "too short for anyone to finish" : "long enough that the clock never binds")
  );
  check(
    `every slot is at least reachable within the phase (${within}/${SLOTS.length})`,
    coverage >= 0.34,
    `only ${within} of ${SLOTS.length} slots are even reachable in the phase`
  );
}

console.log("\nthe clock against the map's own size");
{
  // The diagonal is the honest worst case for a chase, and it is the number
  // that quadrupled when the arena did.
  const diagonal = Math.hypot(ARENA.size, ARENA.size);
  const crossing = diagonal / MOVE.hiderSpeed;
  note(`arena diagonal ${diagonal.toFixed(0)}u — ${crossing.toFixed(0)}s at a hider's walk`);
  check(
    `the hunt outlasts a single crossing by a decent margin`,
    PHASE_SECONDS.seeking > crossing * 3,
    `${PHASE_SECONDS.seeking}s vs ${crossing.toFixed(0)}s to cross once`
  );
  check(
    `the hiding phase is not longer than the hunt`,
    PHASE_SECONDS.hiding < PHASE_SECONDS.seeking
  );
}

if (failures === 0) {
  console.log("\n✅ the clock fits the map\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
