/**
 * Arena invariants.
 *
 * This map is hand-designed rather than generated, so "did it come out the way
 * we meant?" has no generator to answer it. These checks answer it instead.
 * The hiding slots get the most attention because they ARE the design output:
 * a slot has to exist, be empty, and be reachable, or it is only a slot on
 * paper.
 *
 * Run: npm run check:map
 */

import {
  MAP_BOXES,
  SPAWN_POINTS,
  ARENA,
  CLUSTERS,
  BOT_HIDES,
  CLUTTER_TARGET,
  PLATFORMS,
  climbRoute,
  deckTopFor,
  slotOf,
} from "../game/src/game/arena";
import { INSTANCE_MIN, instancingPlan, modelDrawn } from "../game/src/game/instancing";
import { NAV_GRID, findRoute, floodFrom, reached } from "../game/src/game/nav";
import { groundHeightAt, playerBlockedAt, STEP_HEIGHT } from "../game/src/game/map";
import { createMotionState, stepMotion } from "../game/src/game/movement";
import { MAX_PLAYERS, MOVE, SEEKER_SCALE } from "../game/src/game/constants";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

function occupied(x: number, z: number): boolean {
  return playerBlockedAt(x, z, 0, MOVE.playerRadius, MAP_BOXES);
}

/** The highest surface a jump can put you on. */
const MOUNTABLE = (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity) + STEP_HEIGHT;

/**
 * Reachability, in two stages.
 *
 * check-hub.ts just steers the integrator straight at the target, which is
 * enough in an open room. It is not enough here: a row of props IS a wall, and
 * a greedy heading pins itself against the first one it meets and never
 * recovers — it would report a slot as unreachable purely because the walker
 * cannot navigate.
 *
 * So a grid flood-fill finds a route first, and then the game's real integrator
 * is driven along that route. Both claims have to hold: a route must exist
 * through standable cells, and the actual movement code must be able to follow
 * it (a corridor a route can pass through but a 0.45-radius body cannot is
 * caught in the second stage).
 *
 * The flood fill itself moved to game/src/game/nav.ts when the hider bots
 * needed it — they hit the same wall for the same reason. One implementation,
 * two callers; this file keeping its own copy would mean the bots could walk a
 * route the check had never agreed was walkable.
 */
const GRID = NAV_GRID;

const NAV = { boxes: MAP_BOXES, radius: MOVE.playerRadius, halfSize: ARENA.size / 2, grid: GRID };

/** Drive the real integrator along a route; returns the closest it ever got. */
function followRoute(
  start: [number, number],
  route: [number, number][],
  target: [number, number],
  maxSeconds = 60
): number {
  const state = createMotionState([start[0], 0, start[1]]);
  const dt = 1 / 60;
  let best = Math.hypot(target[0] - start[0], target[1] - start[1]);
  let wp = 0;

  for (let i = 0; i < maxSeconds / dt; i++) {
    // Aim at the furthest waypoint we are still close to the route on; simply
    // advancing when within 0.6u keeps the walk from cutting into a prop.
    while (
      wp < route.length - 1 &&
      Math.hypot(route[wp][0] - state.pos[0], route[wp][1] - state.pos[2]) < 0.6
    ) {
      wp++;
    }
    const aim = route[wp];
    const base = Math.atan2(aim[0] - state.pos[0], aim[1] - state.pos[2]);

    stepMotion(state, { forward: 1, strafe: 0, jump: false }, base, {
      boxes: MAP_BOXES,
      dt,
      now: i * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
      worldHalfSize: ARENA.size / 2,
    });

    best = Math.min(best, Math.hypot(target[0] - state.pos[0], target[1] - state.pos[2]));
    if (best < 0.4) break;
  }
  return best;
}

/** Infinity means no route exists at all, as opposed to one we couldn't walk. */
function walkFrom(start: [number, number], target: [number, number]): number {
  const route = findRoute(start, target, NAV);
  if (!route) return Infinity;
  return followRoute(start, route, target);
}

/** Whether the segment between two points runs into a box's side, at eye level. */
function sightBlocked(from: [number, number], to: [number, number], eyeY = 1.5): boolean {
  const steps = 400;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    for (const b of MAP_BOXES) {
      const top = b.p[1] + b.s[1] / 2;
      const bottom = b.p[1] - b.s[1] / 2;
      if (eyeY < bottom || eyeY > top) continue;
      if (Math.abs(x - b.p[0]) < b.s[0] / 2 && Math.abs(z - b.p[2]) < b.s[2] / 2) return true;
    }
  }
  return false;
}

console.log("\nspawn points");

for (const [x, z] of SPAWN_POINTS) {
  check(`(${x}, ${z}) is somewhere a player fits`, !occupied(x, z));
  check(`(${x}, ${z}) is on the floor`, groundHeightAt(x, z, 0, MAP_BOXES) === 0);
}
// Derived, not typed: this said `>= 8` while MAX_PLAYERS said 8, so raising
// the room size would have left it asserting the old number and passing.
check(
  `there are at least MAX_PLAYERS spawn points (${SPAWN_POINTS.length} for ${MAX_PLAYERS})`,
  SPAWN_POINTS.length >= MAX_PLAYERS
);

console.log("\ndesigned hiding slots");

for (const c of CLUSTERS) {
  const [sx, sz] = slotOf(c);
  const label = `${c.family} @ (${sx.toFixed(1)}, ${sz.toFixed(1)})`;

  check(`${label}: the slot is empty`, !occupied(sx, sz));

  // It only reads as "one of the row" if there is a row around it.
  const near = MAP_BOXES.filter(
    (b) => Math.hypot(b.p[0] - sx, b.p[2] - sz) <= c.spacing * 1.6 && b.s[1] < ARENA.wallHeight
  );
  check(`${label}: at least 2 props of the same row adjoin it (${near.length})`, near.length >= 2);

  // Reachable from every spawn. A slot one player cannot walk to is not a
  // hiding place for that player, it is scenery.
  let worst = 0;
  let worstFrom: [number, number] = SPAWN_POINTS[0];
  for (const s of SPAWN_POINTS) {
    const d = walkFrom(s, [sx, sz]);
    if (d > worst) {
      worst = d;
      worstFrom = s;
    }
  }
  check(`${label}: reachable from every spawn (worst ${worst.toFixed(2)}u, from [${worstFrom}])`, worst <= 1.0);
}

console.log("\nfamily step rules");
{
  // Pallets are meant to be walked over and everything else is meant to cost a
  // jump or be unclimbable. Height decides which family a box is in, so the
  // rule survives any change to the layout table.
  const walkable = MAP_BOXES.filter((b) => b.p[1] + b.s[1] / 2 <= STEP_HEIGHT);
  const mountable = MAP_BOXES.filter((b) => {
    const top = b.p[1] + b.s[1] / 2;
    return top > STEP_HEIGHT && top <= MOUNTABLE;
  });
  const tall = MAP_BOXES.filter((b) => b.p[1] + b.s[1] / 2 > MOUNTABLE);

  check(`something can be walked over (${walkable.length}, the pallets)`, walkable.length > 0);
  check(`something needs a jump (${mountable.length}, the crates)`, mountable.length > 0);
  check(`something cannot be climbed at all (${tall.length}, drums/pillars/partitions)`, tall.length > 0);
}

console.log("\nthe giant seeker can reach every hiding zone");
{
  // The seeker's collision radius is SEEKER_SCALE times a hider's. A gap a
  // hider slips through and the seeker cannot is not cover, it is a place the
  // game cannot end — so from the hunt's start every spawn point must be
  // reachable at the seeker's radius. Same flood-fill as the slot checks, at
  // the bigger radius; the route-walking stage is skipped because stepMotion
  // is already exercised above and only the radius differs here.
  const R = MOVE.playerRadius * SEEKER_SCALE;
  // Same flood fill as the slot checks, at the bigger radius. The route-walking
  // stage is skipped because stepMotion is already exercised above and only the
  // radius differs here.
  const parent = floodFrom([0, 0], { ...NAV, radius: R });

  for (const [sx, sz] of SPAWN_POINTS) {
    // The spawn itself only needs a hider to fit; the seeker needs to get NEAR
    // it. Within 2u is close enough that nothing there is out of the gun's
    // reach around a corner.
    let ok = false;
    const reach = Math.ceil(2 / GRID);
    for (let dx = -reach; dx <= reach && !ok; dx++) {
      for (let dz = -reach; dz <= reach && !ok; dz++) {
        if (reached(parent, [sx + dx * GRID, sz + dz * GRID])) ok = true;
      }
    }
    check(`the seeker (radius ${R}) can get within 2u of spawn [${sx}, ${sz}]`, ok);
  }
}

console.log("\nevery platform can be climbed, by both body sizes");
{
  // The stairs' whole contract: drive the real integrator along each climb
  // route with jump held, at the hider's radius AND the giant seeker's. A
  // perch the seeker cannot follow a hider to is a place the game cannot end,
  // so a red here is a layout bug, not a balance choice. The route is data in
  // arena.ts — move a platform without moving its route and this fails.
  const dt = 1 / 60;
  for (const platform of PLATFORMS) {
    const route = climbRoute(platform);
    const deck = route[route.length - 1];

    for (const radius of [MOVE.playerRadius, MOVE.playerRadius * SEEKER_SCALE]) {
      // Start two units out from the first tread, on the approach line.
      const first = route[0];
      const away = Math.atan2(first.x - deck.x, first.z - deck.z);
      const state = createMotionState([
        first.x + Math.sin(away) * 2,
        0,
        first.z + Math.cos(away) * 2,
      ]);

      // One clock across the whole climb. Restarting `now` at each waypoint
      // made now - lastGroundedAt negative, which reads as inside the coyote
      // window forever — the walker jumped in mid-air every pulse and flew to
      // the deck at y 7.8. The game itself feeds performance.now(), which is
      // monotonic; the bug was this driver's alone.
      let frame = 0;
      for (const waypoint of route) {
        for (let i = 0; i < 240; i++, frame++) {
          const dx = waypoint.x - state.pos[0];
          const dz = waypoint.z - state.pos[2];
          if (Math.hypot(dx, dz) < 0.35) break;
          // Pulsed, not held: stepMotion launches on jump's RISING edge, so a
          // held true fires exactly one jump per climb and the walker parks on
          // the first tread forever — which is how this check first failed.
          stepMotion(state, { forward: 1, strafe: 0, jump: (i / 12) % 2 < 1 }, Math.atan2(dx, dz), {
            boxes: MAP_BOXES,
            dt,
            now: frame * dt * 1000,
            speed: MOVE.seekerSpeed,
            radius,
          });
        }
      }

      check(
        `${platform.id}: radius ${radius} reaches the deck (y ${state.pos[1].toFixed(2)} on top ${deck.top})`,
        state.pos[1] >= deck.top - 1e-6 &&
          Math.hypot(state.pos[0] - deck.x, state.pos[2] - deck.z) < 1.2
      );
    }
  }

  // And each deck is above every prop family, or the "second storey" is just
  // another crate.
  for (const p of PLATFORMS) {
    check(`${p.id}: the deck (${deckTopFor(p).toFixed(2)}) clears the tallest prop family`, deckTopFor(p) > 2.0);
  }

  // Two tiers, not one. The high decks exist so that being on a low deck is
  // not automatically safe — somewhere has to look down on them.
  const tiers = new Set(PLATFORMS.map((p) => deckTopFor(p).toFixed(2)));
  check(`the towers come in more than one height (${[...tiers].join(", ")})`, tiers.size >= 2);
}

console.log("\nhand-placed structures do not overlap each other");
{
  // Platforms, buildings and partitions are all written down by hand, and
  // nothing in buildArena rejects one against another — only the clutter
  // sampler checks what is already there. So a tower typed in on top of a
  // landmark would build, render as two models inside each other, and pass
  // every check above. This is the one that says no.
  //
  // Clutter is excluded because it was placed by rejection against everything
  // here, and stacks are excluded from each other because a pile is meant to
  // share its footprint. The perimeter is excluded because the four walls are
  // each a full arena longer than the arena and deliberately cross at the
  // corners, and the roof because it lies over all of it by design.
  const perimeter = (b: (typeof MAP_BOXES)[number]) => b.wall && b.s[1] === ARENA.wallHeight;
  const hand = MAP_BOXES.filter((b) => !b.loose && !b.roof && !perimeter(b));
  // Touching is not intersecting, and this arena touches on purpose: crates
  // stack face to face, a stair tread abuts its neighbour, legs meet their
  // deck, and a partition arm is a whole number of panels spread over a span
  // that is not a whole number of panels wide (11 panels over 12u overlap by
  // 19mm each). A quarter of a metre is the smallest overlap that means
  // someone typed one structure on top of another rather than next to it.
  const TOLERANCE = 0.25;
  let overlaps = 0;
  let example = "";
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const a = hand[i];
      const b = hand[j];
      const hit = [0, 1, 2].every(
        (axis) => (a.s[axis] + b.s[axis]) / 2 - Math.abs(a.p[axis] - b.p[axis]) > TOLERANCE
      );
      if (hit) {
        overlaps++;
        if (!example) {
          example = `${a.family ?? "slab"} at [${a.p.map((n) => n.toFixed(1))}] inside ${
            b.family ?? "slab"
          } at [${b.p.map((n) => n.toFixed(1))}]`;
        }
      }
    }
  }
  check(`no two hand-placed boxes intersect (${overlaps})`, overlaps === 0, example);
}

console.log("\nthe clutter target is actually reached");
{
  // The sampler stops at the target OR at the attempt budget, whichever comes
  // first, and for a long time it was the budget: the file said 640 and the
  // arena had about 230. A stack pushes its whole pile at once, so landing a
  // little over the target is expected and landing under it is the bug.
  const loose = MAP_BOXES.filter((b) => b.loose).length;
  check(
    `${loose} pieces of clutter placed, target ${CLUTTER_TARGET}`,
    loose >= CLUTTER_TARGET && loose < CLUTTER_TARGET + 3
  );
}

console.log("\nthe AI hiders have somewhere to stand");
{
  // A room of MAX_PLAYERS with one human seats MAX_PLAYERS - 1 bots, so those
  // are the entries a full lobby uses; the rest only matter if the roster grows.
  const used = BOT_HIDES.slice(0, MAX_PLAYERS - 1);

  for (const [x, z] of used) {
    check(
      `a bot at (${x}, ${z}) is not standing inside geometry`,
      !playerBlockedAt(x, z, 0, MOVE.playerRadius, MAP_BOXES)
    );
  }

  // Two bodies in one slot is one body from outside, and the seeker would
  // shoot a hider they cannot see standing behind the one they can.
  let overlapping = 0;
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const gap = Math.hypot(used[i][0] - used[j][0], used[i][1] - used[j][1]);
      if (gap < MOVE.playerRadius * 2) overlapping++;
    }
  }
  check(`no two bots share a slot (${used.length} in play)`, overlapping === 0);

  // Spread, not a queue: the interleave in arena.ts exists so a full lobby of
  // bots does not fill one quadrant while another has nobody in it. Quadrant
  // by sign of x and z; nine bots over four quadrants means at least two each
  // once one of them takes the extra.
  const quadrants = new Map<string, number>();
  for (const [x, z] of used) {
    const key = `${x < 0 ? "-" : "+"}${z < 0 ? "-" : "+"}`;
    quadrants.set(key, (quadrants.get(key) ?? 0) + 1);
  }
  check(
    `bots reach all four zones (${[...quadrants.entries()].map(([k, n]) => `${k}:${n}`).join(" ")})`,
    quadrants.size === 4 && [...quadrants.values()].every((n) => n >= 2)
  );
}

console.log("\nrepeated models are instanced");
{
  // The renderer splits models by repetition (instancing.ts). If a model with
  // hundreds of copies falls out of the instanced set, every copy goes back
  // to being its own cloned scene graph — the exact cost the pass removed.
  const plan = instancingPlan(modelDrawn(MAP_BOXES, ARENA.wallHeight));
  const counts = new Map<string, number>();
  for (const b of modelDrawn(MAP_BOXES, ARENA.wallHeight)) {
    const id = b.family ?? "partition";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (n >= INSTANCE_MIN) {
      check(`${id} (${n} copies) takes the instanced path`, plan.instanced.has(id));
    }
  }
  const instancedBoxes = [...plan.instanced.values()].reduce((sum, l) => sum + l.length, 0);
  check(
    `instancing covers most of the arena (${instancedBoxes} instanced vs ${plan.singles.length} singles)`,
    instancedBoxes > plan.singles.length * 10
  );
}

console.log("\nsightlines from the centre");
{
  // The seeker starts at [0,0,0]. If all four zones can be swept from there,
  // the partitions aren't doing their job.
  const zones: [string, [number, number]][] = [
    ["drum", [-12, -12]],
    ["pallet", [12, -12]],
    ["crate", [-12, 12]],
    ["pillar", [12, 12]],
  ];
  for (const [name, c] of zones) {
    check(`the centre of the ${name} zone is not visible from [0,0]`, sightBlocked([0, 0], c));
  }
}

if (failures === 0) {
  console.log("\n✅ arena invariants hold\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
