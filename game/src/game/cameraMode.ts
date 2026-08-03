import type { Phase } from "./constants";
import { ARENA, type MapBox } from "./arena";
import { CAMERA_FLOOR, CAMERA_RADIUS } from "./camera";
import { CELL_BOXES } from "./cell";
import { MAP_BOXES } from "./map";

/**
 * Which camera is driving, decided once per frame.
 *
 * Pulled out of LocalPlayer as a pure function because the interesting part is
 * the ORDER, and the order is the one thing a renderer-less check can pin. The
 * modes are already mutually exclusive elsewhere — painting is refused during
 * the hunt (App's `canPaint = canPose || inCell`, and `canPose` excludes the
 * seeker) and the R toggle refuses the seeker — so this ranking is the safety
 * net for a future change to either of those, not the argument that they hold.
 */
export type CameraMode = "paint" | "freeFly" | "firstPerson" | "follow";

export interface CameraModeInput {
  paintMode: boolean;
  /** R-pinned body; the camera flies free while this is on. */
  charLocked: boolean;
  isSeeker: boolean;
  phase: Phase;
  /**
   * Caught, in the room where that is the end of your round. There is no body
   * left to frame, so the camera has nothing to do but fly.
   */
  spectating?: boolean;
}

export function cameraModeFor({
  paintMode,
  charLocked,
  isSeeker,
  phase,
  spectating,
}: CameraModeInput): CameraMode {
  // Spectating outranks even painting, and has to: the argument for painting
  // winning is that you must be able to see the body you are painting, and a
  // spectator does not have one. Every other mode would be framing a player
  // who is no longer in the world.
  if (spectating) return "freeFly";
  // Painting wins outright: you cannot paint a body you cannot see, so neither
  // a detached camera nor first person may take the view away from it.
  if (paintMode) return "paint";
  if (charLocked && !isSeeker) return "freeFly";
  // The seeker sees through their own eyes both while waiting in the holding
  // cell and while hunting. Paint remains above this branch because painting
  // their body requires the third-person orbit.
  if (isSeeker && (phase === "hiding" || phase === "seeking")) return "firstPerson";
  return "follow";
}

/** Whether mouse movement is allowed to turn the active camera. */
export function pointerLookEnabled(
  paintMode: boolean,
  frozen: boolean,
  spectating: boolean | undefined
): boolean {
  return !paintMode && (!frozen || !!spectating);
}

/**
 * The box a free-flying camera may move in.
 *
 * Nothing stops it on the way — being blocked by crates is the opposite of the
 * point of flying — so this box is the only thing keeping the camera out of the
 * void under the map and off past the walls.
 *
 * The ceiling used to be a wall height above the tallest thing on the map,
 * which put it outdoors at 14u. The arena has a lid now, so that height is no
 * longer somewhere you can be: it is inside the roof slab. The ceiling is the
 * roof's underside less the camera's own padding, which is the highest point
 * that still has the whole arena in front of it rather than a metre of
 * corrugated steel.
 *
 * Note this is the only wall of the box that describes real geometry. The
 * other five are still arbitrary — the free camera does not collide, so the
 * sides and floor are just the edge of where looking is useful.
 */
export const FREE_FLY = {
  /** World units per second. Roughly three times a hider's walk. */
  speed: 18,
  half: ARENA.size / 2,
  floor: CAMERA_FLOOR,
  ceiling: ARENA.wallHeight - CAMERA_RADIUS,
};

export function clampFreeCamera(x: number, y: number, z: number): [number, number, number] {
  const limit = FREE_FLY.half;
  return [
    Math.min(limit, Math.max(-limit, x)),
    Math.min(FREE_FLY.ceiling, Math.max(FREE_FLY.floor, y)),
    Math.min(limit, Math.max(-limit, z)),
  ];
}

/**
 * Which boxes the follow camera is allowed to collide with.
 *
 * Paint mode gets none of them, and that is the whole point of this function
 * existing rather than the ternary being written inline.
 *
 * Painting means reaching all four sides of a body, and a hider paints where
 * they mean to hide — against a wall, under a deck, in a corner. Orbiting to
 * the back from there puts geometry between camera and pivot, and
 * clearCameraDistance answers a blocked ray with the blocked distance:
 * `paintMinDistance` looks like a floor in the signature and is not one. The
 * camera collapsed to centimetres, sat inside the head, and that side of the
 * body became unpaintable — in exactly the spots people paint in.
 *
 * Ignoring the map is safe here and nowhere else. Paint mode is modal, `frozen`
 * covers it, so nobody is moving and the camera is looking inward at its own
 * body. Seeing through a wall for a few seconds is the trade paintMinDistance's
 * comment in constants.ts had already chosen. The floor is unaffected either
 * way — it is a plane, checked separately, and still blocks.
 */
export function cameraBoxesFor(paintMode: boolean, inCell: boolean): MapBox[] {
  if (paintMode) return NO_BOXES;
  return inCell ? CELL_BOXES : MAP_BOXES;
}

const NO_BOXES: MapBox[] = [];
