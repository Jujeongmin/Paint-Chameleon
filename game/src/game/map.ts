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
 * How far a wedged body is shoved toward freedom each frame. Fast enough that
 * being stuck lasts a few frames rather than a second, slow enough that it
 * reads as being squeezed out rather than teleporting.
 */
const UNWEDGE_STEP = 0.18;

/**
 * Move a body that is INSIDE geometry back out of it.
 *
 * This exists because the collision test asks whether a box is a wall using the
 * body's CURRENT FEET HEIGHT: anything whose top is within STEP_HEIGHT of your
 * feet is something you step onto, not something you stop against. Airborne,
 * that is most of the arena — a crate tops out at 0.65 and a drum at 1.35, so a
 * jumping player sails over a whole prop row. Land between two of them and your
 * centre is now inside both, and every direction you try to walk is refused.
 *
 * The giant seeker meets this constantly and a hider almost never does, because
 * the seeker's radius is twice as big: it takes a 1.8u gap to hold them, and
 * the designed rows are 1.3u apart. A sweep of the arena found 654 of 3861
 * inside-a-wall positions that could not be walked out of in any of sixteen
 * directions. That is the bug: not that you can get in, which is a consequence
 * of step-up being height-aware, but that there is no way back out.
 *
 * Two stages, because they answer different questions.
 *
 * The minimum-translation loop handles ordinary shallow overlap: sum how far
 * each wall has to shove you to stop touching it, move, repeat. It converges
 * quickly and moves you the shortest distance, so a body barely clipping a
 * crate corner steps aside rather than being flung.
 *
 * It cannot handle a pocket narrower than the body. Wedged between two props
 * 1.3u apart, the two shoves point at each other and sum to nothing, and no
 * number of iterations changes that — there is genuinely nowhere between them
 * to stand. So if the body is still inside a wall afterwards, look for the
 * nearest place that isn't and take one step toward it. That escapes ALONG the
 * row, which is the direction the geometry actually leaves open.
 */
export function pushOutOfWalls(
  x: number,
  z: number,
  feetY: number,
  radius: number,
  boxes: MapBox[] = MAP_BOXES
): [number, number] {
  // The shove is ATTEMPTED on a copy and only kept if it actually frees the
  // body. In a pocket narrower than the body it never can, and letting its
  // displacement stand was worse than doing nothing: the shove bounced the
  // body between the two walls of the pocket, so every frame the escape search
  // below started somewhere new, chose a different direction, and the 0.18u
  // steps cancelled instead of accumulating. Thirty positions in the arena
  // jittered in place forever. Discarding a failed shove makes the search start
  // from the same place each frame, pick the same way out, and converge.
  let sx = x;
  let sz = z;

  for (let pass = 0; pass < 4; pass++) {
    let pushX = 0;
    let pushZ = 0;
    let deepest = 0;

    for (const b of boxes) {
      if (!isWallAt(b, feetY)) continue;
      // Box against box, exactly as overlapsXZ states it: the body is a square
      // of half-size `radius`, not a circle. An earlier version measured this
      // as a circle and the two tests disagreed at box CORNERS — the square
      // test called the body blocked while the circle found nothing to push
      // against, so this returned "already clear" and the escape search below
      // never ran. 744 positions stayed wedged behind that one mismatch.
      const penX = b.s[0] / 2 + radius - Math.abs(sx - b.p[0]);
      const penZ = b.s[2] / 2 + radius - Math.abs(sz - b.p[2]);
      if (penX <= 0 || penZ <= 0) continue;

      // Out along whichever face is nearer: the shortest way out of a box.
      const depth = Math.min(penX, penZ);
      if (depth > deepest) deepest = depth;
      if (penX < penZ) pushX += Math.sign(sx - b.p[0] || 1) * penX;
      else pushZ += Math.sign(sz - b.p[2] || 1) * penZ;
    }

    // Nothing overlaps, so on the first pass the body was never inside anything
    // — the normal case, and the only cost it pays is this one scan.
    if (deepest === 0) return [sx, sz];
    const push = Math.hypot(pushX, pushZ);
    // Opposing shoves cancelled: the gap is narrower than the body and no
    // amount of pushing sideways opens it. Stage two's job.
    if (push < deepest * 0.25) break;
    // A whisker past the surface, so a resolved contact ends outside it rather
    // than exactly on it, where the next frame's test could go either way.
    sx += pushX * 1.05;
    sz += pushZ * 1.05;
    if (!playerBlockedAt(sx, sz, feetY, radius, boxes)) return [sx, sz];
  }

  // Nearest free ground, searched outward so the body leaves by the shortest
  // route rather than whichever direction is checked first.
  //
  // 9u of reach, not 5. A wedge is not always a pocket you are standing in the
  // middle of: the gap between the drum row at z=-14 and the partition arm
  // above it is 0.98u wide and twelve long, and the giant is 1.8 across, so
  // every point in it is inside a wall and the only way out is off the end of
  // the corridor. Searching 5u left thirty positions in there permanently
  // stuck; the reach has to exceed the longest such gap in the arena, and
  // check:map's own numbers are what say 9 does.
  for (let reach = 0.3; reach <= 9; reach += 0.3) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const tx = x + Math.cos(a) * reach;
      const tz = z + Math.sin(a) * reach;
      if (playerBlockedAt(tx, tz, feetY, radius, boxes)) continue;
      const step = Math.min(UNWEDGE_STEP, reach);
      return [x + Math.cos(a) * step, z + Math.sin(a) * step];
    }
  }
  // Sealed in on every side within five metres. Nothing to do but stay put;
  // check:map's reachability sweep is what keeps this from existing.
  return [x, z];
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

  // After the clamp, not before. worldHalfSize is the FLOOR's half-extent and
  // the perimeter walls straddle that line, so `worldHalfSize - radius` leaves
  // the giant half a metre inside the wall — clamping last would shove a body
  // that had just been freed straight back into it, which is what the first
  // version of this did (744 wedge positions along the perimeter survived the
  // fix). Running it this way round is also stable rather than oscillating:
  // the wall is one of `boxes`, so the shove points inward, which is the same
  // direction the clamp already permits.
  //
  // Normal play pays one overlap test for this — a body that is not inside
  // anything leaves the first pass immediately. It cannot put you through a
  // wall either: it only ever acts on positions the slide above refuses to
  // create in the first place.
  [x, z] = pushOutOfWalls(x, z, y, radius, boxes);

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
