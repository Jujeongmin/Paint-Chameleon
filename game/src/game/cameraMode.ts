import type { Phase } from "./constants";

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
