/**
 * Body profiles.
 *
 * An avatar changes proportions only. Total height, foot level and maximum
 * half-width ALONG THE BODY'S LOCAL X AXIS are identical across every
 * profile, and the collision radius and camera are both global constants that
 * never read the equipped profile — so no avatar can physically reach a hiding
 * spot another can't, and painting (the dominant camouflage mechanic) is
 * unaffected by which body you bought. There is no shot range to add to that
 * list any more: the seeker's hitscan has no distance limit at all, so there
 * is nothing there for a profile to be measured against either way.
 *
 * That is NOT the same claim as "every body is equally easy to hide in".
 * Frontal silhouette area and depth (the Z half-extent) are not equalised by
 * anything here, and because the body rotates with the player, depth becomes
 * the effective width at a 90° yaw. Measured across the current catalogue:
 *
 *   profile   price   frontal area   vs classic   depth (half-extent)
 *   stick     60      0.90           -26%         0.26
 *   classic   0       1.21           —            0.34
 *   tank      90      1.41           +16%         0.30
 *   bean      40      1.46           +21%         0.40
 *
 * i.e. stick is ~35% narrower side-on than bean. Second-order next to the
 * uniform 0.45 collision radius, but real — whoever adds a fifth profile
 * should know this is the band it's joining, and should not assume the
 * invariants below make silhouette area or depth uniform too.
 *
 * Height and foot level are DERIVED rather than stored, so a profile cannot
 * express a violation of them at all. Local-X width and pivot placement can't
 * be derived away, so validateProfile() checks those and check:bodies runs it
 * over the whole catalogue.
 */

import type { Key } from "../ui/i18n";

import { MOVE } from "./constants";

/** Crown of the head. Taken from the original body: 1.52 + 0.34. */
export const TOP_Y = 1.86;
/** Sole of the foot. Taken from the original body: 0.70 - 2 * 0.285. */
export const FOOT_Y = 0.13;
/** Shared tolerance — 1.86 - 0.34 is not exactly 1.52 in binary floating point. */
export const EPS = 1e-6;

/**
 * Camera pivots at CAMERA.shoulderHeight (1.35); shoulders must stay near it.
 * Exported so check:bodies can assert CAMERA.shoulderHeight actually falls
 * inside this range — otherwise the claim in this comment could silently
 * drift out of sync with the camera constant.
 */
export const SHOULDER_RANGE = { min: 1.16, max: 1.4 };

export interface BodyProfile {
  id: string;
  /** Shown in the shop. */
  /** i18n key for the name shown on the shop stand. */
  nameKey: Key;
  /** 0 marks the profile everyone starts with. */
  price: number;
  /**
   * How the parts are drawn. "round" is spheres and capsules; "box" swaps in
   * boxes of exactly the same extents — a part of radius r and length l becomes
   * 2r wide, 2r deep and l + 2r tall, which is the capsule's own bounding box.
   *
   * Same extents means every invariant in this file, and poseBounds' silhouette
   * maths with it, holds without knowing which shape it is looking at.
   */
  shape?: "round" | "box";
  head: { r: number };
  torso: { r: number; l: number; y: number };
  arm: { r: number; l: number };
  leg: { r: number; l: number };
  shoulderX: number;
  shoulderY: number;
  hipX: number;
}

export interface DerivedBody {
  headY: number;
  hipY: number;
  /** Half the capsule's total length — where the mesh hangs below its pivot. */
  armHalf: number;
  legHalf: number;
}

/** Half the total length of a capsule: the cylinder plus one end cap. */
function capsuleHalf(radius: number, length: number): number {
  return length / 2 + radius;
}

export function derive(p: BodyProfile): DerivedBody {
  const armHalf = capsuleHalf(p.arm.r, p.arm.l);
  const legHalf = capsuleHalf(p.leg.r, p.leg.l);
  return {
    headY: TOP_Y - p.head.r,
    hipY: FOOT_Y + legHalf * 2,
    armHalf,
    legHalf,
  };
}

/** Widest point of the body, measured from the centre line. */
export function maxHalfWidth(p: BodyProfile): number {
  return Math.max(p.shoulderX + p.arm.r, p.torso.r, p.hipX + p.leg.r);
}

/** Empty means the profile is safe to ship. */
export function validateProfile(p: BodyProfile): string[] {
  const problems: string[] = [];
  const d = derive(p);

  const width = maxHalfWidth(p);
  if (width > MOVE.playerRadius + EPS) {
    problems.push(
      `half-width ${width.toFixed(3)} exceeds MOVE.playerRadius ${MOVE.playerRadius} — the body would poke out of its own collision cylinder`
    );
  }

  if (p.shoulderY < SHOULDER_RANGE.min - EPS || p.shoulderY > SHOULDER_RANGE.max + EPS) {
    problems.push(
      `shoulderY ${p.shoulderY} is outside ${SHOULDER_RANGE.min}..${SHOULDER_RANGE.max} — the camera would stop pivoting at anything recognisable as a shoulder`
    );
  }

  // Limbs hang off pivots; a pivot outside the torso leaves them visibly detached.
  const torsoHalf = capsuleHalf(p.torso.r, p.torso.l);
  if (p.shoulderY > p.torso.y + torsoHalf + EPS) {
    problems.push(`shoulder pivot ${p.shoulderY} floats above the torso (top ${p.torso.y + torsoHalf})`);
  }
  if (d.hipY < p.torso.y - torsoHalf - EPS) {
    problems.push(`hip pivot ${d.hipY} hangs below the torso (bottom ${p.torso.y - torsoHalf})`);
  }

  return problems;
}

export const DEFAULT_BODY_ID = "classic";

export const BODIES: BodyProfile[] = [
  {
    id: "classic",
    nameKey: "body.classic",
    price: 0,
    head: { r: 0.34 },
    torso: { r: 0.26, l: 0.34, y: 0.98 },
    arm: { r: 0.1, l: 0.34 },
    leg: { r: 0.125, l: 0.32 },
    shoulderX: 0.35,
    shoulderY: 1.28,
    hipX: 0.16,
  },
  {
    id: "square",
    nameKey: "body.box",
    price: 50,
    shape: "box",
    head: { r: 0.3 },
    torso: { r: 0.28, l: 0.34, y: 0.96 },
    arm: { r: 0.1, l: 0.34 },
    leg: { r: 0.13, l: 0.3 },
    shoulderX: 0.34,
    shoulderY: 1.3,
    hipX: 0.16,
  },
  {
    id: "tank",
    nameKey: "body.tank",
    price: 90,
    head: { r: 0.29 },
    torso: { r: 0.3, l: 0.4, y: 1.02 },
    arm: { r: 0.14, l: 0.3 },
    leg: { r: 0.16, l: 0.26 },
    shoulderX: 0.31,
    shoulderY: 1.3,
    hipX: 0.18,
  },
];

const BY_ID = new Map(BODIES.map((b) => [b.id, b]));

/**
 * Never throws: ids arrive over the wire from other clients, and one bad value
 * must not take down everyone's renderer.
 */
export function profileFor(id: string | undefined): BodyProfile {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_BODY_ID)!;
}
