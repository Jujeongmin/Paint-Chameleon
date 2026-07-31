import * as THREE from "three";
import { packUVs, type BodyPart } from "./paint";
import type { BodyProfile } from "./bodies";

/**
 * The six meshes a body is made of, built from a profile.
 *
 * Split out of Humanoid so a check script can measure what the renderer
 * actually draws. The alternative — rebuilding the same six geometries inside
 * the script — would only ever measure a copy, and a copy stops being the
 * thing under test the moment either side is edited.
 *
 * Every part gets its own geometry: packUVs rewrites UVs in place, so two
 * parts sharing one would fight over the same region of the atlas.
 */
export function buildPartGeometries(profile: BodyProfile): Record<BodyPart, THREE.BufferGeometry> {
  const make = (geometry: THREE.BufferGeometry, part: BodyPart) => {
    packUVs(geometry, part);
    return geometry;
  };

  return {
    head: make(new THREE.SphereGeometry(profile.head.r, 24, 18), "head"),
    torso: make(new THREE.CapsuleGeometry(profile.torso.r, profile.torso.l, 6, 18), "torso"),
    armL: make(new THREE.CapsuleGeometry(profile.arm.r, profile.arm.l, 4, 12), "armL"),
    armR: make(new THREE.CapsuleGeometry(profile.arm.r, profile.arm.l, 4, 12), "armR"),
    legL: make(new THREE.CapsuleGeometry(profile.leg.r, profile.leg.l, 4, 12), "legL"),
    legR: make(new THREE.CapsuleGeometry(profile.leg.r, profile.leg.l, 4, 12), "legR"),
  };
}
