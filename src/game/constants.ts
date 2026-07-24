/** Shared tuning. Values duplicated in server/src/rules.ts must stay in sync. */

export type Phase = "lobby" | "hiding" | "seeking" | "results";

/** Phase durations in seconds. */
export const PHASE_SECONDS: Record<Phase, number> = {
  lobby: 0, // ends when enough players ready
  hiding: 45,
  seeking: 90,
  results: 10,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/**
 * Poses a hider can hold, chosen from a menu rather than cycled.
 *
 * Angles are radians applied to the rig's pivots: `armPitch` swings the arms
 * fore/aft at the shoulder, `armSpread` lifts them out sideways, `legPitch`
 * swings the legs at the hip. Keep POSES.length in sync with POSE_COUNT in
 * server/src/rules.ts — check:sync enforces it.
 */
export interface PoseSpec {
  id: string;
  label: string;
  /** Vertical squash of the whole figure. */
  scaleY: number;
  /** Forward tilt of the whole figure; lying down is nearly a right angle. */
  pitch: number;
  /** Vertical offset, so a squashed pose still sits on the floor. */
  lift: number;
  armPitch: number;
  armSpread: number;
  legPitch: number;
  /** Multiplier on how far apart the legs stand. */
  legSpread: number;
}

export const POSES: PoseSpec[] = [
  { id: "stand", label: "서기", scaleY: 1, pitch: 0, lift: 0, armPitch: 0, armSpread: 0.08, legPitch: 0, legSpread: 1 },
  // pitch ~86° lays the root almost flat, which already pulls every child mesh
  // (torso y=0.98, head y=1.52) down near the root's own height — rotation
  // alone does most of the "lying down" work. lift only needs to nudge the
  // rotated rig up by about the head's radius (the largest, so lowest, part
  // once flattened) so it clears the floor instead of sinking through it.
  { id: "lie", label: "눕기", scaleY: 0.95, pitch: 1.5, lift: 0.45, armPitch: 0.25, armSpread: 0.55, legPitch: -0.1, legSpread: 1.15 },
  { id: "banzai", label: "만세", scaleY: 1.04, pitch: -0.06, lift: 0.02, armPitch: -2.85, armSpread: 0.35, legPitch: 0, legSpread: 1.05 },
  { id: "sit", label: "앉기", scaleY: 0.8, pitch: 0.05, lift: -0.3, armPitch: 0.35, armSpread: 0.2, legPitch: 1.45, legSpread: 1.1 },
];

/** Index into POSES for standing — the default, and what a jump snaps back to. */
export const STAND_POSE = 0;

export const POSE_COUNT = POSES.length;

/** Movement tuning (world units per second). */
export const MOVE = {
  hiderSpeed: 6.0,
  seekerSpeed: 6.8,
  playerRadius: 0.45,
  mouseSensitivity: 0.0038,
  /** How fast velocity converges on the input direction. Higher = snappier. */
  groundAccel: 16,
  /** Air control is deliberately weaker so jumps commit. */
  airAccel: 3.5,
  gravity: 22,
  jumpSpeed: 7.4,
  /** Grace period after walking off a ledge where a jump still registers. */
  coyoteMs: 110,
};

/** Seeker tag check. Server-authoritative — client only requests. */
export const TAG = {
  maxDistance: 2.6,
  /** Seeker's forward vector must have at least this dot product with the direction to the target. */
  minFacingDot: 0.55,
  cooldownMs: 700,
};

/** Network send rate for player transforms (ms). Throttled calls bypass the ~10 rpc/s cap. */
export const NET_THROTTLE_MS = 100;
/** Don't resend unless the player actually moved/turned this much. Keeps still hiders silent. */
export const NET_EPSILON = { pos: 0.06, rot: 0.03 };

/** Paint dabs are batched and flushed on this interval rather than per-dab. */
export const PAINT_FLUSH_MS = 140;
/** Hard cap per flush so a frantic drag can't blow up a single message. */
export const PAINT_MAX_BATCH = 32;

/** Brush defaults, matching the reference game's slider range. */
export const BRUSH = {
  min: 4,
  max: 100,
  default: 48,
};

/** Third-person camera. See camera.ts for why the near-range values exist. */
export const CAMERA = {
  playDistance: 5.2,
  paintNear: 1.6,
  paintFar: 5.5,
  /** Floor for occlusion pull-in. Small enough to survive tight corners. */
  minDistance: 0.45,
  /**
   * Paint mode never pulls in this far — you have to be able to see the body
   * you're painting. A little wall clipping beats an unusable brush.
   */
  paintMinDistance: 1.3,
  /** Body is fully solid at or beyond this camera distance. */
  fadeStart: 2.1,
  /** ...and fully hidden at or below it, so we never render the inside of the head. */
  fadeEnd: 1.0,
  /** Camera pivot height: shoulder in third person, eye level once pulled in. */
  shoulderHeight: 1.35,
  eyeHeight: 1.56,
};

export const SCORE = {
  hiderSurvived: 100,
  hiderPerSecondAlive: 1,
  seekerPerCatch: 75,
};
