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

import { MAP_BOXES, SPAWN_POINTS, ARENA, CLUSTERS, slotOf } from "../game/src/game/arena";
import { groundHeightAt, playerBlockedAt, STEP_HEIGHT } from "../game/src/game/map";
import { createMotionState, stepMotion } from "../game/src/game/movement";
import { MOVE } from "../game/src/game/constants";

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
 */
const GRID = 0.5;
const GRID_LIMIT = Math.floor((ARENA.size / 2 - MOVE.playerRadius) / GRID);

function cellKey(ix: number, iz: number): number {
  // 2*GRID_LIMIT+1 fits well inside 1000, so this stays collision-free.
  return (ix + 500) * 1000 + (iz + 500);
}

function standable(ix: number, iz: number): boolean {
  return !occupied(ix * GRID, iz * GRID);
}

/** Flood-fill of everywhere you can walk from `start`, with parent links. */
function reachableFrom(start: [number, number]): Map<number, number> {
  const sx = Math.round(start[0] / GRID);
  const sz = Math.round(start[1] / GRID);
  const parent = new Map<number, number>();
  if (!standable(sx, sz)) return parent;

  const queue: [number, number][] = [[sx, sz]];
  parent.set(cellKey(sx, sz), -1);

  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (Math.abs(nx) > GRID_LIMIT || Math.abs(nz) > GRID_LIMIT) continue;
      const k = cellKey(nx, nz);
      if (parent.has(k) || !standable(nx, nz)) continue;
      parent.set(k, cellKey(x, z));
      queue.push([nx, nz]);
    }
  }
  return parent;
}

/** Waypoints from `start` to `goal`, or null if the flood-fill never got there. */
function routeTo(parent: Map<number, number>, goal: [number, number]): [number, number][] | null {
  const gx = Math.round(goal[0] / GRID);
  const gz = Math.round(goal[1] / GRID);
  let k = cellKey(gx, gz);
  if (!parent.has(k)) return null;

  const out: [number, number][] = [];
  while (k !== -1) {
    const ix = Math.floor(k / 1000) - 500;
    const iz = (k % 1000) - 500;
    out.push([ix * GRID, iz * GRID]);
    k = parent.get(k)!;
  }
  return out.reverse();
}

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
  const route = routeTo(reachableFrom(start), target);
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
check(`there are at least MAX_PLAYERS spawn points (${SPAWN_POINTS.length})`, SPAWN_POINTS.length >= 8);

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
