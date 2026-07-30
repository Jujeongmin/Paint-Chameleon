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

const GUN_URL = "/models/blaster/blaster-j.glb";

/**
 * Native height of the model, from `npm run glb:size` — blaster-a and
 * blaster-r measured 0.800 and 0.683 on the same axis, blaster-j the shortest
 * at 0.610, so it reads closest to something held in one hand rather than
 * shouldered.
 */
const GUN_NATIVE_LENGTH = 0.61;
/** How long the gun should be in the hand. A forearm is about 0.3. */
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

  // Rotated to point along the body's forward (+Z) rather than down the arm.
  return <primitive object={model} rotation={[Math.PI / 2, 0, 0]} />;
}

interface TracerProps {
  from: [number, number, number];
  to: [number, number, number];
}

/**
 * A thin bar from the shot's start point to wherever it stopped. LocalPlayer
 * passes the chest (roughly `CAMERA.shoulderHeight` above the feet), not a
 * true muzzle position, so this only reads as fired from the body — that is
 * the actual behaviour, not an approximation being glossed over here.
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
      ref={(mesh) => {
        if (mesh) mesh.raycast = () => {};
      }}
    >
      <cylinderGeometry args={[0.02, 0.02, length, 6]} />
      <meshBasicMaterial color="#ffe6a0" transparent opacity={0.75} />
    </mesh>
  );
}
