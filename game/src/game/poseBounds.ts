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
import { derive, BODIES, type BodyProfile } from "./bodies";

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

/** One part: the endpoints of its swept segment (a sphere repeats one point) plus a radius. */
interface Part {
  points: V3[];
  r: number;
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

  // Head — a sphere.
  parts.push({ points: [[0, headY, 0]], r: p.head.r });

  // Torso — a capsule: the cylinder spans ±l/2 and the caps add the radius.
  parts.push({
    points: [
      [0, p.torso.y - p.torso.l / 2, 0],
      [0, p.torso.y + p.torso.l / 2, 0],
    ],
    r: p.torso.r,
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
    });
  }

  return parts;
}

export function poseBounds(p: BodyProfile, poseIndex: number): Bounds {
  const spec = POSES[Math.min(Math.max(poseIndex | 0, 0), POSES.length - 1)];
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];

  // The root applies scale(1, scaleY, 1), then rotation X, then a lift — a
  // three.js matrix composes as T·R·S. The non-uniform scale turns every sphere
  // into an ellipsoid, so the radius has to be tracked per axis too. The
  // rotation is about X, which leaves the x half-extent alone.
  const cp = Math.cos(spec.pitch);
  const sp = Math.sin(spec.pitch);

  for (const part of restParts(p, poseIndex)) {
    const ex = part.r;
    const ey = Math.hypot(part.r * spec.scaleY * cp, part.r * sp);
    const ez = Math.hypot(part.r * spec.scaleY * sp, part.r * cp);

    for (const v of part.points) {
      const scaled: V3 = [v[0], v[1] * spec.scaleY, v[2]];
      const w = add(rotX(scaled, spec.pitch), [0, spec.lift, 0]);
      const e: V3 = [ex, ey, ez];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], w[i] - e[i]);
        max[i] = Math.max(max[i], w[i] + e[i]);
      }
    }
  }

  return { min, max };
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
