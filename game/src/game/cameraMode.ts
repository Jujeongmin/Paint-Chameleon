import type { Phase } from "./constants";
import { ARENA } from "./arena";
import { CAMERA_FLOOR } from "./camera";

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
}

export function cameraModeFor({
  paintMode,
  charLocked,
  isSeeker,
  phase,
}: CameraModeInput): CameraMode {
  // Painting wins outright: you cannot paint a body you cannot see, so neither
  // a detached camera nor first person may take the view away from it.
  if (paintMode) return "paint";
  if (charLocked && !isSeeker) return "freeFly";
  if (isSeeker && phase === "seeking") return "firstPerson";
  return "follow";
}

/**
 * The box a free-flying camera may move in.
 *
 * Nothing stops it on the way — being blocked by crates is the opposite of the
 * point of flying — so this box is the only thing keeping the camera out of the
 * void under the map and off past the walls.
 *
 * The ceiling is not a matter of taste. At ARENA.size / 2 the 16:9 view spans
 * 2 * 44 * tan(35 deg) * 16/9 = 110u across, which already contains the whole
 * 88u arena; higher shows nothing new, only smaller. check:camera pins that.
 */
export const FREE_FLY = {
  /** World units per second. Roughly three times a hider's walk. */
  speed: 18,
  half: ARENA.size / 2,
  floor: CAMERA_FLOOR,
  ceiling: ARENA.size / 2,
};

export function clampFreeCamera(x: number, y: number, z: number): [number, number, number] {
  const limit = FREE_FLY.half;
  return [
    Math.min(limit, Math.max(-limit, x)),
    Math.min(FREE_FLY.ceiling, Math.max(FREE_FLY.floor, y)),
    Math.min(limit, Math.max(-limit, z)),
  ];
}
