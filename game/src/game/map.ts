/**
 * Collision. The arena's contents live in arena.ts.
 *
 * arena.ts's names are re-exported verbatim so existing import paths keep
 * working — every other file and check script in this project reaches for
 * "./map".
 */

import { MAP_BOXES, ARENA, type MapBox } from "./arena";

export { MAP_BOXES, ARENA, FLOOR_COLOR, WALL_COLOR, buildArena } from "./arena";
export type { MapBox } from "./arena";

// ---------------------------------------------------------------- collision

/**
 * How high a surface can be and still be walked onto without jumping.
 *
 * This governs two things at once — what counts as ground (`groundHeightAt`)
 * and what counts as a wall (`isWallAt`) — so it is the single number that
 * decides whether a box is an obstacle or a ramp.
 *
 * It was 1.15, which is why players walked up onto crates without jumping.
 * For scale: the body is 1.86 tall and its hips sit at ~0.62-0.82 depending on
 * the profile, so 1.15 was above waist height. Worse, a jump only reaches
 * `jumpSpeed^2 / (2 * gravity)` = 7.4^2 / 44 ≈ 1.24 — the free step-up was
 * covering 93% of the jump, so jumping bought almost nothing and most cover
 * was climbable by walking into it.
 *
 * 0.45 is a step, not a climb: below the hips of every profile (check:movement
 * asserts that against bodies.ts, so it can't drift back up), while still
 * leaving anything up to STEP_HEIGHT + 1.24 reachable with a jump.
 */
export const STEP_HEIGHT = 0.45;

function overlapsXZ(b: MapBox, x: number, z: number, r: number): boolean {
  return (
    Math.abs(x - b.p[0]) < b.s[0] / 2 + r && Math.abs(z - b.p[2]) < b.s[2] / 2 + r
  );
}

/** True if a box is a wall at this standing height — steppable tops and overhead-clear boxes don't count. */
function isWallAt(b: MapBox, feetY: number): boolean {
  const top = b.p[1] + b.s[1] / 2;
  const bottom = b.p[1] - b.s[1] / 2;
  if (top <= feetY + STEP_HEIGHT) return false;
  if (bottom > feetY + 1.8) return false;
  return true;
}

/**
 * Highest surface the player can stand on at (x,z), given their current feet
 * height.
 *
 * `floorY` is the height of the implicit ground plane. It is 0 for the arena
 * and the hub, and it exists because the seeker's holding cell is underground:
 * with a hardcoded zero, standing at y=-8 snaps you to the surface instantly.
 */
export function groundHeightAt(
  x: number,
  z: number,
  feetY: number,
  boxes = MAP_BOXES,
  floorY = 0
): number {
  let best = floorY;
  for (const b of boxes) {
    // The epsilon is what closes the crack between two boxes that abut exactly.
    // overlapsXZ is a strict <, so a point on the shared face of two crates is
    // inside NEITHER of them and this returns the floor — you fall through a
    // seam of zero width. It bit the platform stairs, whose treads are two
    // crates laid side by side: walk up the exact centre line, which is what
    // aiming at the tread's centre makes you do, and the fourth step drops you
    // to the ground. Blocking is left strict on purpose — this is about what
    // holds you up, and a surface you are exactly touching should.
    if (!overlapsXZ(b, x, z, 1e-6)) continue;
    const top = b.p[1] + b.s[1] / 2;
    if (top <= feetY + STEP_HEIGHT && top > best) best = top;
  }
  return best;
}

/**
 * True if a box blocks the player standing at (x,z) with their feet at feetY.
 * Exported so tests can ask the real question instead of reimplementing the
 * rules — a copy silently forgets things like the overhead clearance.
 */
export function playerBlockedAt(
  x: number,
  z: number,
  feetY: number,
  r: number,
  boxes: MapBox[] = MAP_BOXES
): boolean {
  for (const b of boxes) {
    if (!overlapsXZ(b, x, z, r)) continue;
    if (!isWallAt(b, feetY)) continue;
    return true;
  }
  return false;
}

/**
 * Horizontal move only — height is left alone so the caller can run its own
 * gravity. Axis-separated so sliding along a wall keeps the tangential speed.
 */
export function moveXZ(
  from: [number, number, number],
  dx: number,
  dz: number,
  radius: number,
  boxes = MAP_BOXES,
  /** Half-extent of the enclosing space. The hub is smaller than the arena. */
  worldHalfSize = ARENA.size / 2
): [number, number, number] {
  let [x, y, z] = from;

  const xBlocked = dx !== 0 && playerBlockedAt(x + dx, z, y, radius, boxes);
  const zBlocked = dz !== 0 && playerBlockedAt(x, z + dz, y, radius, boxes);

  if (!xBlocked) x += dx;
  if (!zBlocked) z += dz;

  // A flat wall never trips this: the axis with no input is never "blocked"
  // (moving it by zero can't newly collide), so only a concave corner — two
  // separate walls/props pinning a diagonal approach — gets both at once.
  // A tangent-to-the-heading nudge isn't reliable here: at a right-angle
  // inside corner, rotating the heading 90° just trades "into wall A" for
  // "into wall B" (each wall runs the full length of the pocket, not just
  // the corner point), and picking whichever opens first can flip-flop
  // frame to frame, oscillating in place instead of making progress.
  //
  // Push out by the combined penetration depth against every nearby wall
  // instead — standard circle-vs-box minimum-translation-vector resolution.
  // It only depends on the boxes' geometry at the point the player tried to
  // reach, not on which way they're facing, so repeating it every frame
  // converges instead of bouncing between two points, and along an
  // off-centre approach (the common case — a perfectly symmetric 45° hit is
  // the rare exception) it reads as sliding along whichever wall is closer.
  if (xBlocked && zBlocked) {
    const tx = x + dx;
    const tz = z + dz;
    let pushX = 0;
    let pushZ = 0;
    for (const b of boxes) {
      if (!isWallAt(b, y)) continue;
      const halfX = b.s[0] / 2;
      const halfZ = b.s[2] / 2;
      const closestX = Math.max(b.p[0] - halfX, Math.min(tx, b.p[0] + halfX));
      const closestZ = Math.max(b.p[2] - halfZ, Math.min(tz, b.p[2] + halfZ));
      const ox = tx - closestX;
      const oz = tz - closestZ;
      const dist = Math.hypot(ox, oz);
      if (dist >= radius) continue; // this box doesn't actually reach the attempted spot
      if (dist < 1e-6) {
        // Center lands exactly on the box's surface — push along whichever
        // axis has the shallower penetration rather than dividing by zero.
        const penX = halfX + radius - Math.abs(tx - b.p[0]);
        const penZ = halfZ + radius - Math.abs(tz - b.p[2]);
        if (penX < penZ) pushX += Math.sign(tx - b.p[0] || 1) * penX;
        else pushZ += Math.sign(tz - b.p[2] || 1) * penZ;
      } else {
        const depth = radius - dist;
        pushX += (ox / dist) * depth;
        pushZ += (oz / dist) * depth;
      }
    }
    if (pushX !== 0 || pushZ !== 0) {
      const nx = x + pushX;
      const nz = z + pushZ;
      if (!playerBlockedAt(nx, nz, y, radius, boxes)) {
        x = nx;
        z = nz;
      }
    }
  }

  const limit = worldHalfSize - radius;
  x = Math.max(-limit, Math.min(limit, x));
  z = Math.max(-limit, Math.min(limit, z));

  return [x, y, z];
}

/** Spawn point clear of geometry. Mirrors randomSpawn() in server/src/rules.ts. */
export function randomSpawn(boxes = MAP_BOXES): [number, number, number] {
  const limit = ARENA.size / 2 - 2.5;
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() * 2 - 1) * limit;
    const z = (Math.random() * 2 - 1) * limit;
    const clear = !boxes.some(
      (b) => Math.abs(x - b.p[0]) < b.s[0] / 2 + 0.8 && Math.abs(z - b.p[2]) < b.s[2] / 2 + 0.8
    );
    if (clear) return [x, 0, z];
  }
  return [0, 0, 0];
}
