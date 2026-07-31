/**
 * Third-person camera collision.
 *
 * Two failure modes have to be handled together, or fixing one causes the other:
 *
 *  1. Without collision the camera passes through walls and floors and you see
 *     the level from inside the geometry.
 *  2. With naive collision, backing into a wall leaves nowhere to retreat to, so
 *     the camera ends up inside the player's own head — backfaces, near-plane
 *     slicing, the model filling the screen.
 *
 * So: march the ray outward and stop at the first obstruction (1), and as the
 * camera is forced in, dissolve the body and rise to eye height so the result
 * reads as a deliberate first-person view rather than a glitch (2).
 */

import { MAP_BOXES, type MapBox } from "./map";

/**
 * Padding around the camera point. Must exceed the projection near plane (0.1)
 * or a technically-outside camera still clips into the surface it's hugging.
 */
export const CAMERA_RADIUS = 0.32;

/** Keep the camera above the floor; dipping under it shows the level from below. */
export const CAMERA_FLOOR = 0.3;

/**
 * Strictly inside a solid, ignoring the padding. This — not `cameraBlockedAt` —
 * is the condition that actually shows the level through a wall; the padded
 * version is deliberately conservative so the camera stops short of surfaces.
 */
export function cameraInsideSolid(
  x: number,
  y: number,
  z: number,
  boxes: MapBox[] = MAP_BOXES,
  /** Height of the implicit floor plane; the holding cell's is below zero. */
  floorY = 0
): boolean {
  if (y < floorY) return true;
  for (const b of boxes) {
    if (
      Math.abs(x - b.p[0]) < b.s[0] / 2 &&
      Math.abs(y - b.p[1]) < b.s[1] / 2 &&
      Math.abs(z - b.p[2]) < b.s[2] / 2
    ) {
      return true;
    }
  }
  return false;
}

export function cameraBlockedAt(
  x: number,
  y: number,
  z: number,
  boxes: MapBox[] = MAP_BOXES,
  /** Height of the implicit floor plane; the holding cell's is below zero. */
  floorY = 0
): boolean {
  if (y < floorY + CAMERA_FLOOR) return true;
  for (const b of boxes) {
    if (
      Math.abs(x - b.p[0]) < b.s[0] / 2 + CAMERA_RADIUS &&
      Math.abs(y - b.p[1]) < b.s[1] / 2 + CAMERA_RADIUS &&
      Math.abs(z - b.p[2]) < b.s[2] / 2 + CAMERA_RADIUS
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Distance along `dir` at which the ray first enters a box, or null if it
 * never does. Slab method, against the same box `cameraBlockedAt` describes:
 * grown by CAMERA_RADIUS on every axis, which is what makes a point test stand
 * in for a camera with size. Returns 0 when the ray starts inside one.
 */
function rayBoxEntry(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  box: MapBox
): number | null {
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  let near = 0;
  let far = Infinity;

  for (let axis = 0; axis < 3; axis++) {
    const half = box.s[axis] / 2 + CAMERA_RADIUS;
    const low = box.p[axis] - half;
    const high = box.p[axis] + half;

    if (Math.abs(d[axis]) < 1e-9) {
      // Parallel to this pair of faces: either always between them or never.
      if (o[axis] < low || o[axis] > high) return null;
      continue;
    }

    const t1 = (low - o[axis]) / d[axis];
    const t2 = (high - o[axis]) / d[axis];
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return null;
  }

  return near;
}

/**
 * How far back the camera can sit along `dir` before something gets in the way.
 *
 * Solved rather than sampled. Marching outward and stopping at the first
 * blocked point looks equivalent and is not: with 24 steps over 5.2u the
 * samples are 0.22u apart, and the arena is 621 props of about that size, so
 * whether a barrel behind the player was seen at all depended on where the
 * samples happened to land. Half a step of walking moved them, the answer
 * flipped between "clear at 5.2" and "blocked at 0" — and since the rig snaps
 * inward the instant something intrudes, that read on screen as the camera
 * hurling itself through the player's head and back out again.
 *
 * The geometry each box describes is unchanged: same CAMERA_RADIUS padding on
 * every axis, same floor. Only the aliasing is gone.
 */
export function clearCameraDistance(
  target: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  desired: number,
  minDistance: number,
  boxes: MapBox[] = MAP_BOXES,
  /** Height of the implicit floor plane; the holding cell's is below zero. */
  floorY = 0
): number {
  let allowed = desired;

  // The floor is a plane, not a box, and only ever blocks a downward ray.
  if (dir.y < -1e-9) {
    const hit = (floorY + CAMERA_FLOOR - target.y) / dir.y;
    if (hit < allowed) allowed = Math.max(0, hit);
  } else if (target.y < floorY + CAMERA_FLOOR) {
    // Already under it — the pivot itself is below the floor plane.
    allowed = 0;
  }

  for (const box of boxes) {
    const hit = rayBoxEntry(target, dir, box);
    if (hit !== null && hit < allowed) allowed = hit;
  }

  // Wedged into a corner: pull all the way in rather than punch through.
  return allowed < minDistance ? Math.min(minDistance, Math.max(allowed, 0)) : allowed;
}

/**
 * How solid the local player's body should be at a given camera distance.
 * 1 = normal third person, 0 = fully first person.
 */
export function bodyFadeFor(distance: number, fadeEnd: number, fadeStart: number): number {
  if (distance >= fadeStart) return 1;
  if (distance <= fadeEnd) return 0;
  return (distance - fadeEnd) / (fadeStart - fadeEnd);
}
