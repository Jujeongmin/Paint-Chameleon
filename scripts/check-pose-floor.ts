/**
 * Every pose rests on the floor — checked against the real geometry.
 *
 * `poseBounds` describes the silhouette analytically: capsule endpoints, radii,
 * and the root's scale/rotation worked out by hand. `groundedLift` is derived
 * from it, and Humanoid uses that to place the body. So poseBounds being wrong
 * would put every pose at the wrong height, and asserting anything against
 * poseBounds itself cannot notice — the numbers would agree with each other all
 * the way down.
 *
 * This builds the ACTUAL meshes with buildPartGeometries, hangs them in the
 * same THREE.Object3D hierarchy Humanoid uses, applies groundedLift, and reads
 * the lowest vertex in world space. Two independent routes to one number.
 *
 * The tolerance is one-sided and that is not slack. A tessellated capsule's
 * vertices sit ON the surface at the sampled angles and INSIDE it between them,
 * so the mesh minimum is always at or above the analytic minimum, never below.
 * A body sunk into the floor therefore still fails, which is the direction that
 * matters.
 *
 * Run: npm run check:pose-floor
 */

import * as THREE from "three";
import { POSES } from "../game/src/game/constants";
import { BODIES, FOOT_Y, derive, type BodyProfile } from "../game/src/game/bodies";
import { buildPartGeometries } from "../game/src/game/bodyGeometry";
import { groundedLift } from "../game/src/game/poseBounds";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label + (detail ? ` — ${detail}` : ""));
  else {
    failures++;
    console.error("  ✗ " + label + (detail ? `\n      ${detail}` : ""));
  }
}

/**
 * Half the angular gap between adjacent rings on a 12-segment capsule cap, as a
 * fraction of the radius — how far a facet's midpoint falls inside the true
 * surface. `1 - cos(pi / 12 / 2)` is about 0.0086, so on the largest radius in
 * the catalogue this is well under a millimetre.
 */
const FACET_SLACK = 1 - Math.cos(Math.PI / 24);

/**
 * Rounding only. The box profiles land on the floor exactly, and "exactly" in
 * binary floating point after a chain of matrix multiplies means a few units in
 * the last place either way. A ten-thousandth of a centimetre — four orders of
 * magnitude below the 1.82cm error this check was written to catch.
 */
const FLOAT_EPS = 1e-6;

/** Rebuilds Humanoid's rest hierarchy for one body in one pose. */
function poseRoot(profile: BodyProfile, poseIndex: number): THREE.Object3D {
  const spec = POSES[poseIndex];
  const { headY, hipY, armHalf, legHalf } = derive(profile);
  const geoms = buildPartGeometries(profile);

  const root = new THREE.Object3D();
  root.scale.set(1, spec.scaleY, 1);
  root.rotation.x = spec.pitch;
  root.position.y = groundedLift(profile, poseIndex);

  const head = new THREE.Mesh(geoms.head);
  head.position.y = headY;
  root.add(head);

  const torso = new THREE.Mesh(geoms.torso);
  torso.position.y = profile.torso.y;
  root.add(torso);

  // Left is -1 so that a positive armSpread pushes both arms outward, which is
  // the sign convention Humanoid's JSX uses on shoulder rotation.z.
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Object3D();
    shoulder.position.set(side * profile.shoulderX, profile.shoulderY, 0);
    shoulder.rotation.x = spec.armPitch;
    shoulder.rotation.z = side * spec.armSpread;
    const arm = new THREE.Mesh(side < 0 ? geoms.armL : geoms.armR);
    arm.position.y = -armHalf;
    shoulder.add(arm);
    root.add(shoulder);

    const hip = new THREE.Object3D();
    hip.position.set(side * profile.hipX * spec.legSpread, hipY, 0);
    hip.rotation.x = spec.legPitch;
    const leg = new THREE.Mesh(side < 0 ? geoms.legL : geoms.legR);
    leg.position.y = -legHalf;
    hip.add(leg);
    root.add(hip);
  }

  root.updateMatrixWorld(true);
  return root;
}

/** Lowest vertex of the whole posed figure, in world space. */
function lowestVertex(root: THREE.Object3D): number {
  let low = Infinity;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      if (v.y < low) low = v.y;
    }
  });
  return low;
}

console.log("pose floor contact (real geometry vs poseBounds' maths)");

for (let i = 0; i < POSES.length; i++) {
  for (const b of BODIES) {
    const maxRadius = Math.max(b.head.r, b.torso.r, b.arm.r, b.leg.r);
    const slack = maxRadius * FACET_SLACK + FLOAT_EPS;
    const low = lowestVertex(poseRoot(b, i));
    const gap = low - FOOT_Y;

    check(
      `${POSES[i].id} on ${b.id} touches the floor`,
      gap >= -FLOAT_EPS && gap <= slack,
      `lowest vertex ${low.toFixed(5)}, floor ${FOOT_Y} — ` +
        (gap < 0 ? `${(-gap * 100).toFixed(2)}cm through it` : `${(gap * 100).toFixed(2)}cm above, slack ${(slack * 100).toFixed(2)}cm`)
    );
  }
}

console.log(failures ? `\n❌ ${failures} pose(s) not on the floor\n` : "\n✅ every pose rests on the floor\n");
process.exit(failures ? 1 : 0);
