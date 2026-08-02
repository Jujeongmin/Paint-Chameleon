/**
 * Bounding box of a pose's silhouette.
 *
 * Reproduces Humanoid.tsx's REST layout — the state every animated term
 * (walk swing, airborne tuck, landing squash) converges to when the player is
 * standing still — as pure maths. The arena's prop families take their
 * dimensions from these numbers, and mimicry is unforgiving: a prop that is
 * close to the silhouette but subtly off makes a disguised player MORE
 * conspicuous, not less, because the eye catches the odd one out in a row.
 *
 * check:bodies is what stops this drifting away from Humanoid: it asserts the
 * standing silhouette's top and bottom land exactly on TOP_Y / FOOT_Y, which
 * bodies.ts derives by a completely separate route. Change one side only and
 * that anchor breaks first.
 *
 * No three.js import — the check scripts have to run without a renderer.
 */

import { POSES } from "./constants";
import { derive, BODIES, FOOT_Y, type BodyProfile } from "./bodies";

type V3 = [number, number, number];

/** three.js's default Euler order XYZ means R = Rx·Ry·Rz, so Z is applied first. */
function rotZ([x, y, z]: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c, z];
}

function rotX([x, y, z]: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * One part: the endpoints of its swept segment (a sphere repeats one point)
 * plus a radius, and the orientation of the group it hangs in.
 *
 * `rot` only matters for the box-shaped profiles. A capsule is a swept SPHERE,
 * so how it is turned about its own axis changes nothing about its extent —
 * which is why this was untyped for a long time and nothing noticed. A box has
 * corners, and a corner sweeps further than the rounded surface it replaces, so
 * for those the orientation is the whole question.
 */
interface Part {
  points: V3[];
  r: number;
  /** Rotation of the part's own group, in root-child space. */
  rot: M3;
}

/** Row-major 3x3. Only ever built from rotations about X and Z. */
type M3 = [V3, V3, V3];

const IDENTITY: M3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function mulM(a: M3, b: M3): M3 {
  const out: M3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function matX(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

function matZ(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

export interface Bounds {
  min: V3;
  max: V3;
}

/**
 * Every part as seen in the root group's child space. Transcribed from
 * Humanoid's JSX placement plus the values its useFrame settles on at rest.
 */
function restParts(p: BodyProfile, poseIndex: number): Part[] {
  const spec = POSES[Math.min(Math.max(poseIndex | 0, 0), POSES.length - 1)];
  const { headY, hipY, armHalf, legHalf } = derive(p);
  const parts: Part[] = [];

  // Head — a sphere, or a cube on the box-shaped profiles.
  parts.push({ points: [[0, headY, 0]], r: p.head.r, rot: IDENTITY });

  // Torso — a capsule: the cylinder spans ±l/2 and the caps add the radius.
  parts.push({
    points: [
      [0, p.torso.y - p.torso.l / 2, 0],
      [0, p.torso.y + p.torso.l / 2, 0],
    ],
    r: p.torso.r,
    rot: IDENTITY,
  });

  // Arms hang at (0, -armHalf, 0) inside a shoulder group rotated X=armPitch,
  // Z=∓armSpread (mirrored so positive spread pushes both arms outward).
  for (const side of [-1, 1]) {
    const local: V3[] = [
      [0, -armHalf - p.arm.l / 2, 0],
      [0, -armHalf + p.arm.l / 2, 0],
    ];
    const origin: V3 = [side * p.shoulderX, p.shoulderY, 0];
    parts.push({
      points: local.map((v) => add(rotX(rotZ(v, side * spec.armSpread), spec.armPitch), origin)),
      r: p.arm.r,
      // Euler XYZ means R = Rx·Ry·Rz, so Z is applied to the part first — the
      // same order the point transform above uses.
      rot: mulM(matX(spec.armPitch), matZ(side * spec.armSpread)),
    });
  }

  // Legs hang inside a hip group rotated X=legPitch; legSpread scales hipX.
  for (const side of [-1, 1]) {
    const local: V3[] = [
      [0, -legHalf - p.leg.l / 2, 0],
      [0, -legHalf + p.leg.l / 2, 0],
    ];
    const origin: V3 = [side * p.hipX * spec.legSpread, hipY, 0];
    parts.push({
      points: local.map((v) => add(rotX(v, spec.legPitch), origin)),
      r: p.leg.r,
      rot: matX(spec.legPitch),
    });
  }

  return parts;
}

/** The silhouette before the root's vertical lift is applied. */
function unliftedBounds(p: BodyProfile, poseIndex: number): Bounds {
  const spec = POSES[Math.min(Math.max(poseIndex | 0, 0), POSES.length - 1)];
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];

  // The root applies scale(1, scaleY, 1), then rotation X, then a lift — a
  // three.js matrix composes as T·R·S. The non-uniform scale turns every sphere
  // into an ellipsoid, so the radius has to be tracked per axis too. The
  // rotation is about X, which leaves the x half-extent alone.
  const cp = Math.cos(spec.pitch);
  const sp = Math.sin(spec.pitch);

  // Root rotation composed with the non-uniform scale, which the matrix order
  // T·R·S applies to the child BEFORE the root turns it. Only needed for boxes.
  const rootRS: M3 = mulM(matX(spec.pitch), [
    [1, 0, 0],
    [0, spec.scaleY, 0],
    [0, 0, 1],
  ]);
  const boxy = p.shape === "box";

  for (const part of restParts(p, poseIndex)) {
    let ex: number;
    let ey: number;
    let ez: number;

    if (boxy) {
      // A box's extent along an axis is the sum of |row · half-extent| over its
      // own three axes — corners included, which is the whole point. The part's
      // half extents are r on both horizontal axes and r vertically, because
      // the segment endpoints below already carry the length.
      const m = mulM(rootRS, part.rot);
      const h: V3 = [part.r, part.r, part.r];
      ex = Math.abs(m[0][0]) * h[0] + Math.abs(m[0][1]) * h[1] + Math.abs(m[0][2]) * h[2];
      ey = Math.abs(m[1][0]) * h[0] + Math.abs(m[1][1]) * h[1] + Math.abs(m[1][2]) * h[2];
      ez = Math.abs(m[2][0]) * h[0] + Math.abs(m[2][1]) * h[1] + Math.abs(m[2][2]) * h[2];
    } else {
      // A capsule is a swept sphere: the scale turns it into an ellipsoid and
      // the root rotation gives the projected half extents. Its own orientation
      // does not enter, because a sphere has none.
      ex = part.r;
      ey = Math.hypot(part.r * spec.scaleY * cp, part.r * sp);
      ez = Math.hypot(part.r * spec.scaleY * sp, part.r * cp);
    }

    for (const v of part.points) {
      const scaled: V3 = [v[0], v[1] * spec.scaleY, v[2]];
      const w = rotX(scaled, spec.pitch);
      const e: V3 = [ex, ey, ez];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], w[i] - e[i]);
        max[i] = Math.max(max[i], w[i] + e[i]);
      }
    }
  }

  return { min, max };
}

/**
 * The lift that puts this body's lowest point on the floor in this pose.
 *
 * This used to be a hand-authored `lift` field on each pose, and hand-authoring
 * cannot reach the answer: the three body profiles have different radii, so a
 * rotated pose bottoms out at a different height for each, and one number
 * cannot satisfy three. Lying was the visible case — it hovered between 7.5cm
 * and 9.3cm depending on the body. Crouching had drifted the other way and sank
 * 2.3cm INTO the floor on two of the three.
 *
 * Standing needs no lift and never did: `derive` builds the legs downward from
 * FOOT_Y, so its soles land there for every profile. That makes FOOT_Y the
 * floor, and every other pose simply has to reach the line standing already
 * reaches.
 *
 * Exact and one step, because the lift is a pure translation. It also stays
 * right when a fourth avatar is added, which is the part a constant could
 * never do.
 */
export function groundedLift(p: BodyProfile, poseIndex: number): number {
  return FOOT_Y - unliftedBounds(p, poseIndex).min[1];
}

/**
 * The silhouette as drawn — lift included, so the bottom is always FOOT_Y.
 */
export function poseBounds(p: BodyProfile, poseIndex: number): Bounds {
  const raw = unliftedBounds(p, poseIndex);
  const lift = groundedLift(p, poseIndex);
  return {
    min: [raw.min[0], raw.min[1] + lift, raw.min[2]],
    max: [raw.max[0], raw.max[1] + lift, raw.max[2]],
  };
}

export function poseSize(p: BodyProfile, poseIndex: number) {
  const b = poseBounds(p, poseIndex);
  return {
    width: b.max[0] - b.min[0],
    height: b.max[1] - b.min[1],
    depth: b.max[2] - b.min[2],
  };
}

/**
 * The largest silhouette across the whole catalogue. Prop families size
 * themselves from this: mimicry only holds if no avatar you can buy sticks out
 * past the object it is pretending to be.
 */
export function maxPoseSize(poseIndex: number) {
  const sizes = BODIES.map((b) => poseSize(b, poseIndex));
  return {
    width: Math.max(...sizes.map((s) => s.width)),
    height: Math.max(...sizes.map((s) => s.height)),
    depth: Math.max(...sizes.map((s) => s.depth)),
  };
}

/**
 * How high the silhouette reaches above the floor, across the whole catalogue.
 *
 * This, not the silhouette's height, is what a prop standing on the ground
 * should be: a box runs from y=0 up, while a pose can float clear of the floor
 * (standing, the soles sit at FOOT_Y). Sizing a drum to the standing height
 * 1.73 would leave every player's head poking 0.13 above the row.
 */
export function maxPoseTop(poseIndex: number): number {
  return Math.max(...BODIES.map((b) => poseBounds(b, poseIndex).max[1]));
}
