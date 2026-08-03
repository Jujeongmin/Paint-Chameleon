import * as THREE from "three";
import type { MapBox } from "./map";
import { setCameraOcclusion } from "./cameraOcclusion";

/** Third-person camera shared by the match and hub. */
export interface FollowScratch {
  target: THREE.Vector3;
  back: THREE.Vector3;
  look: THREE.Vector3;
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
  desired: number;
  minDistance: number;
  boxes: MapBox[];
  dt: number;
  shoulderHeight: number;
  eyeHeight: number;
  fadeEnd: number;
  fadeStart: number;
  allowFade: boolean;
  floorY?: number;
}

/**
 * Keep the authored orbit even when geometry crosses it. Map materials open a
 * temporary visibility corridor instead of forcing the camera into the body.
 */
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

  scratch.distance = opts.desired;
  const target = scratch.target.set(px, py + opts.shoulderHeight, pz);
  camera.position.copy(target).addScaledVector(back, scratch.distance);
  camera.lookAt(scratch.look.copy(camera.position).addScaledVector(back, -1));
  setCameraOcclusion(camera, target, opts.desired > 0.1);
  return 1;
}
