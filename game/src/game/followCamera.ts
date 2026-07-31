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
  /** Height of the implicit floor plane; the holding cell's is below zero. */
  floorY?: number;
}

/** Positions the camera and returns how solid the local body should be (0..1). */
export function updateFollowCamera(
  camera: THREE.Camera,
  scratch: FollowScratch,
  opts: FollowOptions
): number {
  const [px, py, pz] = opts.pos;

  const back = scratch.back
    .set(
      -Math.sin(opts.yaw) * Math.cos(opts.pitch),
      Math.sin(opts.pitch),
      -Math.cos(opts.yaw) * Math.cos(opts.pitch)
    )
    .normalize();

  // Trace from the shoulder, always. The rendered pivot rises toward the eyes
  // as the camera is forced in (below), and tracing from THAT was a feedback
  // loop: raising the pivot lifted the ray over the obstacle, which allowed a
  // longer distance, which lowered the pivot again, which put the ray back into
  // the obstacle. The camera oscillated for as long as you stood near anything
  // roughly shoulder-high — which in this arena is most of the props.
  const trace = scratch.target.set(px, py + opts.shoulderHeight, pz);

  const allowed = clearCameraDistance(
    trace,
    back,
    opts.desired,
    opts.minDistance,
    opts.boxes,
    opts.floorY ?? 0
  );

  // Inward fast, outward slow. Instant inward was the other half of the same
  // jitter: a prop's edge sliding across the ray moved `allowed` by metres in
  // one frame, and snapping to it read as the camera being thrown at the
  // player's head. dt * 30 covers 5.2u in about a tenth of a second, fast
  // enough that the sliver of clipping it allows is not on screen long enough
  // to see, and the pull-out stays slower still so the camera does not pop.
  const rate = allowed < scratch.distance ? 30 : 8;
  scratch.distance = THREE.MathUtils.lerp(
    scratch.distance,
    allowed,
    Math.min(1, opts.dt * rate)
  );

  const closeness = opts.allowFade
    ? 1 - bodyFadeFor(scratch.distance, opts.fadeEnd, opts.fadeStart)
    : 0;
  const pivot = THREE.MathUtils.lerp(opts.shoulderHeight, opts.eyeHeight, closeness);
  const target = scratch.target.set(px, py + pivot, pz);

  camera.position.copy(target).addScaledVector(back, scratch.distance);

  // Look ALONG the view axis, not AT the pivot: when the distance collapses to
  // zero the camera sits on the pivot, and lookAt() would get a zero-length
  // direction and fall back to a fixed axis, freezing the view.
  camera.lookAt(scratch.look.copy(camera.position).addScaledVector(back, -1));

  return opts.allowFade ? bodyFadeFor(scratch.distance, opts.fadeEnd, opts.fadeStart) : 1;
}
