/** Shared tuning. Values duplicated in server/src/rules.ts must stay in sync. */

import type { Key } from "../ui/i18n";

export type Phase = "lobby" | "hiding" | "seeking" | "results";

/** Phase durations in seconds. */
export const PHASE_SECONDS: Record<Phase, number> = {
  lobby: 0, // ends when enough players ready
  /**
   * Not a travel budget — a painting budget.
   *
   * check:balance walks the real integrator from every spawn to the nearest
   * designed slot and the worst case is 3.8 seconds. So this was never the
   * "can you get there in time" number it was written down as, even after the
   * arena quadrupled; twenty-six of these thirty seconds are for choosing a
   * colour and covering yourself in it. How long THAT actually takes has never
   * been measured, and is the reason this stays at 30 rather than being cut to
   * fit the walk.
   */
  hiding: 30,
  /**
   * Retuned from 90 against a measurement, not a hunch.
   *
   * check:balance drives a nearest-first tour of all twenty-four hiding slots
   * at the seeker's speed, which is the CHEAPEST possible sweep and therefore
   * an upper bound on what any player can cover. It takes 73 seconds. At 90 the
   * seeker could walk past every hiding place on the map and still have seventeen
   * seconds spare, which means the clock was not a constraint on them at all —
   * and a hunt whose time limit never binds is not a hunt.
   *
   * 75 puts the phase a whisker over that perfect sweep: an optimal seeker
   * finishes with nothing to spare, and a real one — who has to stop, look at
   * things and decide whether a barrel is a person — covers a good deal less.
   *
   * This is an inference from a bound, not a playtest. It is one constant,
   * mirrored in server/src/rules.ts and held there by check:sync, so it is a
   * one-line revert if playing says otherwise.
   */
  seeking: 75,
  // Long enough to walk the reveal: the hiders the seeker never found glow
  // through the walls for this whole phase, and ten seconds was not enough to
  // look around and see where they had been.
  results: 30,
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
  /** i18n key for the name shown in the pose menu. */
  labelKey: Key;
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
  { id: "stand", labelKey: "pose.stand", scaleY: 1, pitch: 0, lift: 0, armPitch: 0, armSpread: 0.08, legPitch: 0, legSpread: 1 },
  // pitch ~86° lays the root almost flat, which already pulls every child mesh
  // (torso y=0.98, head y=1.52) down near the root's own height — rotation
  // alone does most of the "lying down" work. lift only needs to nudge the
  // rotated rig up by about the head's radius (the largest, so lowest, part
  // once flattened) so it clears the floor instead of sinking through it.
  { id: "lie", labelKey: "pose.lie", scaleY: 0.95, pitch: 1.5, lift: 0.45, armPitch: 0.25, armSpread: 0.55, legPitch: -0.1, legSpread: 1.15 },
  { id: "banzai", labelKey: "pose.reach", scaleY: 1.04, pitch: -0.06, lift: 0.02, armPitch: -2.85, armSpread: 0.35, legPitch: 0, legSpread: 1.05 },
  { id: "sit", labelKey: "pose.crouch", scaleY: 0.8, pitch: 0.05, lift: -0.3, armPitch: 0.35, armSpread: 0.2, legPitch: 1.45, legSpread: 1.1 },
];

/** Index into POSES for standing — the default, and what a jump snaps back to. */
export const STAND_POSE = 0;

export const POSE_COUNT = POSES.length;

/**
 * The seeker is drawn, collided and eye-heighted at this multiple of a hider.
 * Client-only: the server checks neither radius nor map, so nothing there
 * reads it — clampMoveXZ bounds speed, not size.
 *
 * Everything size-shaped multiplies by this in exactly one place each
 * (LocalPlayer for the local rig, RemotePlayers for peers, cell.ts for the
 * room that has to hold the giant), so the hider path stays byte-for-byte
 * unchanged when this is 1.
 */
export const SEEKER_SCALE = 2;

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

/**
 * The seeker's shot. Server-authoritative for everything except the line of
 * sight, which only the client can judge: the server has no map.
 *
 * There is no maxDistance. See the gun design doc's first section before
 * adding one back — the server cannot check what it cannot see, so any limit
 * here would be a number with no reasoning behind it.
 *
 * KEEP IN SYNC WITH SHOT in server/src/rules.ts — check:sync compares them.
 */
export const SHOT = {
  minFacingDot: 0.55,
  cooldownMs: 700,
};

/** Network send rate for player transforms (ms). Throttled calls bypass the ~10 rpc/s cap. */
export const NET_THROTTLE_MS = 100;
/** Don't resend unless the player actually moved/turned this much. Keeps still hiders silent. */
export const NET_EPSILON = { pos: 0.06, rot: 0.03 };

/**
 * Mirror of PAINT_LIMITS in server/src/rules.ts, which clamps every dab it
 * relays. A radius the server would clamp has to be clamped here first, or the
 * dab a player sees on their own body is not the one everyone else gets.
 *
 * KEEP IN SYNC — check:sync compares them.
 */
export const PAINT = {
  maxRadius: 120,
  maxBatch: 32,
};

/** Paint dabs are batched and flushed on this interval rather than per-dab. */
export const PAINT_FLUSH_MS = 140;
/**
 * Hard cap per flush so a frantic drag can't blow up a single message. Reads
 * the mirrored limit rather than restating 32: the server drops everything past
 * its own maxBatch, so a second copy of this number could only ever be a way to
 * silently throw dabs away.
 */
export const PAINT_MAX_BATCH = PAINT.maxBatch;

/**
 * Brush radius in WORLD units — how wide a dab is on the body, not how many
 * texels it covers.
 *
 * Texels were the wrong unit: each part's uv rect is fitted to that part's own
 * proportions (see packUVs), so one texel is about 0.013 world units on a head
 * and 0.004 on an arm. The same slider value painted a dot on one part and a
 * stripe on another, and the smallest setting was only small on some of them.
 *
 * The wire still carries texels — useBrush converts at the moment of the dab,
 * using the scale packUVs recorded on the part it hit, so every client redraws
 * the identical dab without needing to know whose body it landed on.
 *
 * Both ends are set by the catalogue's extremes rather than by feel, and
 * check:paint pins them on every part of every avatar. The coarsest surface is
 * classic's head at 77 texels per world unit, so anything under 0.0195 lands
 * beneath the dab's own 1.5-texel floor and the bottom of the slider would
 * stop doing anything. The finest is classic's arm at 262, so anything over
 * 0.458 is clamped by the server on its way to everyone else and the painter
 * would be the only one seeing the size they picked.
 */
export const BRUSH = {
  min: 0.02,
  max: 0.3,
  default: 0.12,
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
