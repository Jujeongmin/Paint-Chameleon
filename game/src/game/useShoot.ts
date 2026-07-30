import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SHOT } from "./constants";

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
  /**
   * True when the pending pointerdown is the click recapturing pointer lock
   * rather than an aimed shot. usePointerLook's own listener requests lock on
   * every canvas click while unlocked (Esc-then-click is how it's regained),
   * and that request is asynchronous — so on that exact click
   * `document.pointerLockElement` is still not the canvas. Without this check
   * the same click that gets the mouse back also fires a shot along whatever
   * the crosshair was left on.
   */
  isRecapture: () => boolean;
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

export function useShoot({ active, selfAccount, onFire, isRecapture }: Options): void {
  const { camera, scene, gl } = useThree();
  const latest = useRef({ selfAccount, onFire, isRecapture });
  latest.current = { selfAccount, onFire, isRecapture };
  /**
   * Mirrors the server's own cooldown so a click inside it produces no
   * client-side result at all — no tracer, no sound, no RPC — instead of a
   * shot that looks and sounds real but that canShoot() (rules.ts) is about
   * to refuse. Declared outside the effect below so it survives `active`
   * flipping off and on (e.g. painting toggled mid-cooldown) rather than
   * resetting the gate on every remount.
   */
  const lastFireAt = useRef(0);

  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const centre = new THREE.Vector2(0, 0);

    const fire = () => {
      const now = performance.now();
      if (now - lastFireAt.current < SHOT.cooldownMs) return;
      lastFireAt.current = now;

      // The crosshair is the aim in both lock states, not the OS cursor. Under
      // lock that's obvious — the cursor is pinned there. Unlocked it still is:
      // Hud renders the crosshair fixed at the viewport centre and free look
      // (input.ts) turns the camera on bare mousemove, so the camera — and
      // with it the centre of the view — is what the cursor's own position
      // never tracks.
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
      if (latest.current.isRecapture()) return;
      fire();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    return () => canvas.removeEventListener("pointerdown", onPointerDown);
  }, [active, camera, scene, gl]);
}
