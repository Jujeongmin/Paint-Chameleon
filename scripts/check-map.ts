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

import { MAP_BOXES, SPAWN_POINTS, ARENA } from "../src/game/arena";
import { groundHeightAt, playerBlockedAt, STEP_HEIGHT } from "../src/game/map";
import { createMotionState, stepMotion } from "../src/game/movement";
import { MOVE } from "../src/game/constants";

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
 * Same idea as check-hub.ts's walkTo: drive the game's real integrator toward a
 * target and see how close it gets. Steering probes a fan of offsets from the
 * straight-line heading so a box in the way is walked around rather than
 * treated as unreachable.
 */
function walkFrom(start: [number, number], target: [number, number], maxSeconds = 30): number {
  const state = createMotionState([start[0], 0, start[1]]);
  const dt = 1 / 60;
  let best = Infinity;

  for (let i = 0; i < maxSeconds / dt; i++) {
    const dx = target[0] - state.pos[0];
    const dz = target[1] - state.pos[2];
    best = Math.min(best, Math.hypot(dx, dz));
    if (best < 0.4) break;

    const before: [number, number] = [state.pos[0], state.pos[2]];
    const base = Math.atan2(dx, dz);
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
      const probe = {
        ...state,
        pos: [...state.pos] as [number, number, number],
        vel: [...state.vel] as [number, number],
      };
      stepMotion(probe, { forward: 1, strafe: 0, jump: false }, base + off, {
        boxes: MAP_BOXES,
        dt,
        now: i * dt * 1000,
        speed: MOVE.hiderSpeed,
        radius: MOVE.playerRadius,
        worldHalfSize: ARENA.size / 2,
      });
      const moved = Math.hypot(probe.pos[0] - before[0], probe.pos[2] - before[1]);
      if (moved > 0.005 || off === 2.4 || off === -2.4) {
        state.pos = probe.pos;
        state.vel = probe.vel;
        state.vy = probe.vy;
        state.grounded = probe.grounded;
        state.lastGroundedAt = probe.lastGroundedAt;
        break;
      }
    }
  }
  return best;
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
