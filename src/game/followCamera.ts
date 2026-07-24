import * as THREE from "three";
import { bodyFadeFor, clearCameraDistance } from "./camera";
import type { MapBox } from "./map";

/**
 * Third-person follow camera, shared by the match and the hub.
 *
 * Everything hard-won about this camera lives here: outward ray marching so it
 * can't end up behind a wall, the rise to eye height plus body dissolve when
 * there's nowhere to retreat to, and looking along the view axis rather than at
 * the pivot (which degenerates the moment the two coincide).
 */

export interface FollowScratch {
  target: THREE.Vector3;
  back: THREE.Vector3;
  look: THREE.Vector3;
  /** Smoothed distance, carried between frames. */
  distance: number;
}

export function createFollowScratch(distance: number): FollowScratch {
  return {
    target: new THREE.Vector3(),
    back: new THREE.Vector3(),
    look: new THREE.Vector3(),
    distance,
  };
}

export interface FollowOptions {
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  /** Distance we'd like, before collision. */
  desired: number;
  minDistance: number;
  boxes: MapBox[];
  dt: number;
  /** Pivot height when fully third person, and when fully pulled in. */
  shoulderHeight: number;
  eyeHeight: number;
  fadeEnd: number;
  fadeStart: number;
  /** Paint mode keeps the body solid — you have to see what you're painting. */
  allowFade: boolean;
}

/** Positions the camera and returns how solid the local body should be (0..1). */
export function updateFollowCamera(
  camera: THREE.Camera,
  scratch: FollowScratch,
  opts: FollowOptions
): number {
  const [px, py, pz] = opts.pos;

  // Pivot rises toward the eyes as the camera is forced in. Uses last frame's
  // distance — the pivot must exist before we can trace from it, and a single
  // frame of lag is imperceptible.
  const closeness = opts.allowFade
    ? 1 - bodyFadeFor(scratch.distance, opts.fadeEnd, opts.fadeStart)
    : 0;
  const pivot = THREE.MathUtils.lerp(opts.shoulderHeight, opts.eyeHeight, closeness);

  const target = scratch.target.set(px, py + pivot, pz);
  const back = scratch.back
    .set(
      -Math.sin(opts.yaw) * Math.cos(opts.pitch),
      Math.sin(opts.pitch),
      -Math.cos(opts.yaw) * Math.cos(opts.pitch)
    )
    .normalize();

  const allowed = clearCameraDistance(target, back, opts.desired, opts.minDistance, opts.boxes);

  // Snap inward the instant something intrudes — easing in would clip through
  // it — but ease back out once the way is clear, or the camera pops.
  scratch.distance =
    allowed < scratch.distance
      ? allowed
      : THREE.MathUtils.lerp(scratch.distance, allowed, Math.min(1, opts.dt * 8));

  camera.position.copy(target).addScaledVector(back, scratch.distance);

  // Look ALONG the view axis, not AT the pivot: when the distance collapses to
  // zero the camera sits on the pivot, and lookAt() would get a zero-length
  // direction and fall back to a fixed axis, freezing the view.
  camera.lookAt(scratch.look.copy(camera.position).addScaledVector(back, -1));

  return opts.allowFade ? bodyFadeFor(scratch.distance, opts.fadeEnd, opts.fadeStart) : 1;
}
