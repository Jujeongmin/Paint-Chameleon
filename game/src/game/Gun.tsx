import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

/**
 * The seeker's blaster, and the tracer it leaves.
 *
 * Loaded through R3F's useLoader rather than drei's useGLTF: importing drei
 * pulls a second pre-bundled copy of @react-three/fiber into the dev server and
 * every hook in the component throws "Invalid hook call" — an error that
 * points at this file and is really about module resolution.
 */

export const GUN_URL = "/models/blaster/blaster-j.glb";

// Starts the fetch as soon as this module is evaluated (app start), rather
// than waiting for the hiding→seeking transition that first mounts <Gun/>.
// Still paired with its own <Suspense> at the call site in LocalPlayer —
// preloading only makes the cache warm by the time it's needed on a normal
// connection, it does not guarantee the fetch has finished, and it does
// nothing to shrink the blast radius if the fetch fails outright.
useLoader.preload(GLTFLoader, GUN_URL);

/**
 * Native height of the model, from `npm run glb:size` — blaster-a and
 * blaster-r measured 0.800 and 0.683 on the same axis, blaster-j the
 * shortest at 0.610 and the smallest candidate on every axis.
 */
const GUN_NATIVE_LENGTH = 0.61;
/**
 * How long the gun should be in the hand. The default profile's arm capsule
 * (bodies.ts: r 0.1, l 0.34) gives armHalf 0.27, so a full arm is 0.54 —
 * 0.42 is about 78% of that, not "a forearm's worth" of it.
 */
const GUN_LENGTH = 0.42;

export function Gun() {
  const gltf = useLoader(GLTFLoader, GUN_URL);

  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const centre = new THREE.Vector3();
    box.getCenter(centre);

    const holder = new THREE.Group();
    clone.position.set(-centre.x, -centre.y, -centre.z);
    holder.add(clone);
    holder.scale.setScalar(GUN_LENGTH / GUN_NATIVE_LENGTH);
    holder.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    return holder;
  }, [gltf]);

  // No rotation here. The barrel runs along the model's longest axis, and
  // `npm run glb:size` measures blaster-j at 0.155 x 0.362 x 0.610 — so that
  // axis is the model's local Z, and leaving it unrotated keeps it on the
  // body's own forward (+Z). Humanoid's hand group is what cancels the aiming
  // shoulder's pitch, so by the time this mounts the frame is already level;
  // adding a rotation here would tilt it back off.
  //
  // What the bounding box cannot tell us is which END of that axis the muzzle
  // is on. If it points backwards the fix is rotation={[0, Math.PI, 0]} — a Y
  // rotation, never an X one. Unconfirmed, and on the visual checklist.
  return <primitive object={model} />;
}

interface TracerProps {
  from: [number, number, number];
  to: [number, number, number];
}

// A stable no-op so R3F's applyProps assigns the same function every render
// instead of detaching and reattaching a fresh one each time (which is what
// happens if this is written inline as `raycast={() => {}}`).
const NO_RAYCAST = () => {};

/**
 * A thin bar from the shot's start point to wherever it stopped. LocalPlayer
 * passes the chest (roughly `CAMERA.shoulderHeight` above the feet), not a
 * true muzzle position, so this only reads as fired from the body.
 *
 * A cylinder rather than a THREE.Line: line width above 1 is ignored on every
 * platform this runs on, and a one-pixel tracer is invisible at the distances
 * this gun works at.
 */
export function Tracer({ from, to }: TracerProps) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const len = direction.length() || 0.001;
    const mid = a.clone().add(direction.clone().multiplyScalar(0.5));
    // A cylinder is built along +Y, so rotate that onto the shot's direction.
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize()
    );
    return { position: mid, quaternion: q, length: len };
  }, [from, to]);

  return (
    <mesh
      position={position}
      quaternion={quaternion}
      // This mesh sits at the scene root (see LocalPlayer), not inside any
      // account-tagged group, so useShoot's ancestor walk has nothing to skip
      // it by. It is mounted for 80ms — long enough to still be here when the
      // next shot fires — so it needs its own exclusion rather than relying on
      // timing. Overriding raycast to a no-op removes it from every raycast
      // unconditionally, which is simpler to reason about than putting it on a
      // non-default layer (that would depend on useShoot's raycaster keeping
      // its default layer mask forever) and adds no clause to useShoot's own
      // filter loop, where every clause is one more thing that can wrongly
      // swallow a real hit.
      raycast={NO_RAYCAST}
    >
      <cylinderGeometry args={[0.02, 0.02, length, 6]} />
      <meshBasicMaterial color="#ffe6a0" transparent opacity={0.75} />
    </mesh>
  );
}
