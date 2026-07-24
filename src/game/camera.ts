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
  boxes: MapBox[] = MAP_BOXES
): boolean {
  if (y < 0) return true;
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
  boxes: MapBox[] = MAP_BOXES
): boolean {
  if (y < CAMERA_FLOOR) return true;
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
 * How far back the camera can sit along `dir` before something gets in the way.
 * Walks outward from the player and stops at the first blocked sample, so the
 * result is always on the player's side of any wall — checking only the far end
 * would happily park the camera in open space beyond it.
 */
export function clearCameraDistance(
  target: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  desired: number,
  minDistance: number,
  boxes: MapBox[] = MAP_BOXES
): number {
  const steps = 24;
  let safe = 0;

  for (let i = 1; i <= steps; i++) {
    const d = (desired * i) / steps;
    if (cameraBlockedAt(target.x + dir.x * d, target.y + dir.y * d, target.z + dir.z * d, boxes)) {
      break;
    }
    safe = d;
  }

  // Wedged into a corner: pull all the way in rather than punch through.
  return safe < minDistance ? Math.min(minDistance, Math.max(safe, 0)) : safe;
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
