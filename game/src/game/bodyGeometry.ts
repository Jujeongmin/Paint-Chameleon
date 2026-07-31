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
  const boxy = profile.shape === "box";

  // A capsule and the box that replaces it occupy the same volume of space:
  // 2r on both horizontal axes, l + 2r tall. Nothing that measures a body —
  // derive(), maxHalfWidth(), poseBounds — has to care which it got.
  const limb = (r: number, l: number) =>
    boxy
      ? new THREE.BoxGeometry(r * 2, l + r * 2, r * 2)
      : new THREE.CapsuleGeometry(r, l, 4, 12);

  const make = (geometry: THREE.BufferGeometry, part: BodyPart) => {
    packUVs(geometry, part);
    return geometry;
  };

  return {
    head: make(
      boxy
        ? new THREE.BoxGeometry(profile.head.r * 2, profile.head.r * 2, profile.head.r * 2)
        : new THREE.SphereGeometry(profile.head.r, 24, 18),
      "head"
    ),
    torso: make(
      boxy
        ? new THREE.BoxGeometry(
            profile.torso.r * 2,
            profile.torso.l + profile.torso.r * 2,
            profile.torso.r * 2
          )
        : new THREE.CapsuleGeometry(profile.torso.r, profile.torso.l, 6, 18),
      "torso"
    ),
    armL: make(limb(profile.arm.r, profile.arm.l), "armL"),
    armR: make(limb(profile.arm.r, profile.arm.l), "armR"),
    legL: make(limb(profile.leg.r, profile.leg.l), "legL"),
    legR: make(limb(profile.leg.r, profile.leg.l), "legR"),
  };
}
