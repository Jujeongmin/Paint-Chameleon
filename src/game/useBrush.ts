import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PaintDab } from "./paint";

export type Tool = "brush" | "picker";

interface Options {
  active: boolean;
  /** Group holding the local player's body meshes — the only paintable target. */
  bodyRef: React.RefObject<THREE.Group>;
  tool: Tool;
  color: number;
  /** Brush radius in texture pixels. */
  brushSize: number;
  /** Called for every dab; `join` continues the previous stroke rather than starting one. */
  onDab: (dab: PaintDab, join: boolean) => void;
  /** Reads a colour out of the local player's own paint texture. */
  sampleBody: (u: number, v: number) => number;
  /** Resolved eyedropper colour, from the world or from your own body. */
  onPick: (color: number) => void;
  /** Dragging empty space orbits the camera instead of painting. */
  onOrbit: (dx: number, dy: number) => void;
  onZoom: (delta: number) => void;
}

/** Material base colour of a hit mesh, converted back to an sRGB hex. */
/**
 * What a surface reads as to the eyedropper.
 *
 * Normally that is the material's own colour. A textured surface can't use
 * that: its material colour has to be white or it would tint the map, and
 * picking white would be worse than picking nothing. So a textured mesh states
 * its representative colour in `userData.pickColor` — the average tone of its
 * texture — and that wins.
 *
 * Camouflage is the reason this matters. The player can only paint flat
 * colours, so whatever this returns is the closest they can get to the surface.
 */
function materialColor(object: THREE.Object3D): number | null {
  const stated = object.userData?.pickColor;
  if (typeof stated === "number") return stated;

  const material = (object as THREE.Mesh).material;
  const single = Array.isArray(material) ? material[0] : material;
  const colored = single as THREE.MeshStandardMaterial | undefined;
  if (!colored?.color) return null;
  return colored.color.getHex();
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D | null): boolean {
  if (!ancestor) return false;
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node === ancestor) return true;
    node = node.parent;
  }
  return false;
}

/**
 * Pointer-driven painting on the local player's own body, plus an eyedropper
 * that reads either the world or the body.
 *
 * Settings come in through a ref so the listeners install once per activation —
 * re-binding on every colour or brush-size change would drop an in-flight stroke.
 */
export function useBrush(opts: Options) {
  const { gl, camera, scene } = useThree();
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!opts.active) return;
    const canvas = gl.domElement;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const bodyMeshes: THREE.Mesh[] = [];

    let painting = false;
    let orbiting = false;
    let lastSentUV: { u: number; v: number } | null = null;

    const toNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
    };

    const hitBody = (clientX: number, clientY: number) => {
      const body = latest.current.bodyRef.current;
      if (!body) return null;

      bodyMeshes.length = 0;
      body.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) bodyMeshes.push(o as THREE.Mesh);
      });
      if (!bodyMeshes.length) return null;

      toNdc(clientX, clientY);
      const hit = raycaster.intersectObjects(bodyMeshes, false)[0];
      return hit?.uv ? { u: hit.uv.x, v: hit.uv.y } : null;
    };

    /** Eyedropper: whatever is under the cursor, world or body. */
    const pickAt = (clientX: number, clientY: number): number | null => {
      toNdc(clientX, clientY);
      const hits = raycaster.intersectObjects(scene.children, true);

      for (const hit of hits) {
        const mesh = hit.object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) continue;

        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        // The self-locate wireframe isn't a real surface.
        if ((material as THREE.Material & { wireframe?: boolean })?.wireframe) continue;

        if (isDescendantOf(mesh, latest.current.bodyRef.current)) {
          if (!hit.uv) continue;
          return latest.current.sampleBody(hit.uv.x, hit.uv.y);
        }
        const c = materialColor(mesh);
        if (c !== null) return c;
      }
      return null;
    };

    const emit = (uv: { u: number; v: number }, join: boolean) => {
      const { brushSize, color, onDab } = latest.current;
      onDab({ u: uv.u, v: uv.v, r: brushSize, c: color }, join);
      lastSentUV = uv;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      if (latest.current.tool === "picker") {
        const picked = pickAt(e.clientX, e.clientY);
        if (picked !== null) {
          latest.current.onPick(picked);
          return;
        }
        // Nothing under the cursor — fall through to orbiting.
      }

      const uv = latest.current.tool === "brush" ? hitBody(e.clientX, e.clientY) : null;
      if (!uv) {
        orbiting = true;
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      painting = true;
      canvas.setPointerCapture(e.pointerId);
      emit(uv, false);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (orbiting) {
        latest.current.onOrbit(e.movementX, e.movementY);
        return;
      }
      if (!painting) return;

      const uv = hitBody(e.clientX, e.clientY);
      if (!uv) return;

      // Decimate: only send once the brush has travelled a fraction of its own
      // width, so a slow drag doesn't flood the wire with near-identical dabs.
      if (lastSentUV) {
        const px = Math.hypot(uv.u - lastSentUV.u, uv.v - lastSentUV.v) * 512;
        if (px < Math.max(2, latest.current.brushSize * 0.35)) return;
      }
      emit(uv, true);
    };

    const onPointerUp = (e: PointerEvent) => {
      painting = false;
      orbiting = false;
      lastSentUV = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      latest.current.onZoom(Math.sign(e.deltaY));
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [opts.active, gl, camera, scene]);
}
