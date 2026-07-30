import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * The seeker's aim.
 *
 * The client decides whether a shot connected, because the server has no map
 * and so cannot tell whether a wall was in the way. The whole judgement is one
 * raycast: whatever the ray reaches FIRST is what was shot. A hider's body
 * means a hit; a crate, a partition or the floor means the shot stopped there.
 * Cover works because cover is nearer than what is behind it — there is no
 * separate line-of-sight test to get wrong.
 *
 * Modelled on useBrush: one raycaster, listeners on the canvas, and a ref that
 * carries the latest props so the handlers never go stale.
 */

export interface ShotResult {
  /** Whose body was hit, or null for a miss. */
  account: string | null;
  /** Where the ray stopped, for the tracer to end at. */
  point: [number, number, number];
}

interface Options {
  /** Only the seeker, only during the hunt. */
  active: boolean;
  selfAccount: string;
  onFire: (result: ShotResult) => void;
}

/** How far a tracer runs when the ray hits nothing at all. */
const MISS_DISTANCE = 200;

/** Walk up from a hit mesh looking for the account a body group carries. */
function accountOf(object: THREE.Object3D): string | null {
  let node: THREE.Object3D | null = object;
  while (node) {
    const account = node.userData?.account;
    if (typeof account === "string" && account.length > 0) return account;
    node = node.parent;
  }
  return null;
}

export function useShoot({ active, selfAccount, onFire }: Options): void {
  const { camera, scene, gl } = useThree();
  const latest = useRef({ selfAccount, onFire });
  latest.current = { selfAccount, onFire };

  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const centre = new THREE.Vector2();

    const fire = (clientX: number, clientY: number) => {
      // Under pointer lock the cursor is pinned, so the shot goes through the
      // crosshair at the centre. Without it, aim where the cursor actually is.
      if (document.pointerLockElement === canvas) {
        centre.set(0, 0);
      } else {
        const r = canvas.getBoundingClientRect();
        centre.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
      }
      raycaster.setFromCamera(centre, camera);

      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        const mesh = hit.object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) continue;

        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        // The self-locate wireframe is not a surface a shot can hit.
        if ((material as THREE.Material & { wireframe?: boolean })?.wireframe) continue;

        const account = accountOf(mesh);
        // Our own body sits between the camera and the world in third person;
        // without this it would eat every shot as a point-blank miss on
        // ourselves. Both RemotePlayer and LocalPlayer tag their body group
        // with userData.account so this walk always has something to match.
        if (account === latest.current.selfAccount) continue;

        latest.current.onFire({
          account,
          point: [hit.point.x, hit.point.y, hit.point.z],
        });
        return;
      }

      // Nothing at all — fire into the distance so the tracer still reads.
      const direction = raycaster.ray.direction.clone().multiplyScalar(MISS_DISTANCE);
      const end = raycaster.ray.origin.clone().add(direction);
      latest.current.onFire({ account: null, point: [end.x, end.y, end.z] });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      fire(e.clientX, e.clientY);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    return () => canvas.removeEventListener("pointerdown", onPointerDown);
  }, [active, camera, scene, gl]);
}
