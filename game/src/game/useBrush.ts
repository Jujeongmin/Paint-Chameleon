import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SURFACE_SIZE, type PaintDab } from "./paint";
import { PAINT } from "./constants";

export type Tool = "brush" | "picker";

/**
 * Texels per world unit for a part packUVs did not measure — nothing in the
 * catalogue today, since every part is a sphere or a capsule, but a body made
 * of some other shape would land here rather than painting nothing. Roughly
 * what a limb reports, so the brush stays the size the slider says.
 */
const FALLBACK_SCALE = 260;

/** The dab's own floor: below this a radial gradient has nothing to grade. */
const MIN_TEXEL_RADIUS = 1.5;

interface Options {
  active: boolean;
  /** Group holding the local player's body meshes — the only paintable target. */
  bodyRef: React.RefObject<THREE.Group>;
  tool: Tool;
  color: number;
  /** Brush radius in world units; see BRUSH in constants.ts. */
  brushSize: number;
  /** Called for every dab; `join` continues the previous stroke rather than starting one. */
  onDab: (dab: PaintDab, join: boolean) => void;
  /** One wheel notch of brush size, +1 bigger / -1 smaller. */
  onBrushStep: (dir: number) => void;
  /**
   * Where the brush would land and how big it would be, in screen pixels, or
   * null when the pointer is off the body. Drives the ring drawn under the
   * cursor — the crosshair cannot show a size, and the size is the one thing
   * about this brush you cannot otherwise see before committing to a stroke.
   */
  onCursor: (cursor: { x: number; y: number; radius: number } | null) => void;
  /** Reads a colour out of the local player's own paint texture. */
  sampleBody: (u: number, v: number) => number;
  /** Resolved eyedropper colour, from the world or from your own body. */
  onPick: (color: number) => void;
  /** Dragging empty space orbits the camera instead of painting. */
  onOrbit: (dx: number, dy: number) => void;
  onZoom: (delta: number) => void;
}

/**
 * Decoded pixels of a texture, kept per texture image.
 *
 * Drawing to a canvas is the only way to read a texture back on the CPU, and
 * doing it per click on a 1024² atlas would stall the frame the player clicked
 * on. Keyed on the image rather than the Texture because clones share it.
 */
const pixelCache = new WeakMap<CanvasImageSource, ImageData | null>();

function pixelsOf(image: CanvasImageSource): ImageData | null {
  const cached = pixelCache.get(image);
  if (cached !== undefined) return cached;

  let data: ImageData | null = null;
  const width = (image as HTMLImageElement).width;
  const height = (image as HTMLImageElement).height;
  if (width && height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      try {
        ctx.drawImage(image, 0, 0);
        data = ctx.getImageData(0, 0, width, height);
      } catch {
        // A cross-origin image taints the canvas. Everything here is served
        // from our own origin, but failing soft beats throwing mid-click.
        data = null;
      }
    }
  }

  pixelCache.set(image, data);
  return data;
}

/** Fold a repeated coordinate back into [0,1); JS `%` keeps the sign. */
function wrap01(v: number): number {
  return ((v % 1) + 1) % 1;
}

function clampIndex(v: number, size: number): number {
  return Math.min(size - 1, Math.max(0, Math.floor(v)));
}

function singleMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial | undefined {
  const material = mesh.material;
  return (Array.isArray(material) ? material[0] : material) as
    | THREE.MeshStandardMaterial
    | undefined;
}

/**
 * What a surface reads as to the eyedropper, at the exact point clicked.
 *
 * Sampling the texture rather than the material colour is the whole point. A
 * textured material's colour is white — it has to be, or it would tint the map
 * — so anything derived from it is either white or a stand-in the player can
 * see is wrong. The props all share one texture atlas, so a stand-in per model
 * meant picking a barrel and getting a colour no barrel is.
 *
 * The player can only paint flat colours, so whatever comes back here is the
 * closest they can get to the surface they aimed at.
 *
 * Falls back to `userData.pickColor` and then the material colour, for surfaces
 * with no texture or whose image hasn't decoded yet.
 */
function surfaceColor(mesh: THREE.Mesh, uv: THREE.Vector2 | undefined): number | null {
  const material = singleMaterial(mesh);
  const map = material?.map;

  if (map?.image && uv) {
    const pixels = pixelsOf(map.image as CanvasImageSource);
    if (pixels) {
      // The repeat/offset a tiled surface carries is applied by the shader, not
      // baked into the uv the raycaster hands back, so it has to be redone here
      // — otherwise every pick on the floor samples the same corner of the tile.
      const u = wrap01(uv.x * map.repeat.x + map.offset.x);
      const v = wrap01(uv.y * map.repeat.y + map.offset.y);
      const px = clampIndex(u * pixels.width, pixels.width);

      // Which way v runs depends on how the texture was loaded, and getting it
      // wrong is invisible on a photograph and catastrophic on a palette atlas:
      // the Kenney models all share one, so a mirrored row lands on an
      // unrelated colour rather than a slightly-off one.
      //
      // TextureLoader flips the image on upload (flipY true), so v=0 is the
      // bottom row and the lookup has to be inverted. GLTFLoader does not —
      // glTF puts uv origin at the top left — so v maps straight to the row.
      const row = map.flipY ? 1 - v : v;
      const py = clampIndex(row * pixels.height, pixels.height);
      const i = (py * pixels.width + px) * 4;
      return (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
    }
  }

  const stated = mesh.userData?.pickColor;
  if (typeof stated === "number") return stated;
  return material?.color ? material.color.getHex() : null;
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
      if (!hit?.uv) return null;

      // Brush size is a world measurement; the dab is drawn in texels. packUVs
      // recorded what one world unit is worth on this part, because that number
      // is different on every part — the whole reason a texel-sized brush
      // painted a dot on an arm and a saucer on a head.
      const mesh = hit.object as THREE.Mesh;
      const scale = (mesh.geometry?.userData?.texelsPerWorld as number | undefined) ?? FALLBACK_SCALE;
      const radius = Math.min(
        PAINT.maxRadius,
        Math.max(MIN_TEXEL_RADIUS, latest.current.brushSize * scale)
      );

      return { u: hit.uv.x, v: hit.uv.y, radius, distance: hit.distance };
    };

    /** Radius on screen, in CSS pixels, of a world-sized brush at `distance`. */
    const screenRadius = (distance: number) => {
      const fov = ((camera as THREE.PerspectiveCamera).fov ?? 70) * (Math.PI / 180);
      const halfHeight = Math.tan(fov / 2) * Math.max(distance, 0.01);
      return (latest.current.brushSize / halfHeight) * (canvas.clientHeight / 2);
    };

    const showCursor = (e: PointerEvent, hit: { distance: number } | null) => {
      latest.current.onCursor(
        hit ? { x: e.clientX, y: e.clientY, radius: screenRadius(hit.distance) } : null
      );
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
        const c = surfaceColor(mesh, hit.uv);
        if (c !== null) return c;
      }
      return null;
    };

    const emit = (uv: { u: number; v: number; radius: number }, join: boolean) => {
      const { color, onDab } = latest.current;
      onDab({ u: uv.u, v: uv.v, r: uv.radius, c: color }, join);
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
        latest.current.onCursor(null);
        return;
      }

      const uv = hitBody(e.clientX, e.clientY);
      // Hovering counts: the ring has to be there before the stroke starts, or
      // it cannot tell you what size you are about to commit to.
      showCursor(e, latest.current.tool === "brush" ? uv : null);
      if (!painting || !uv) return;

      // Decimate: only send once the brush has travelled a fraction of its own
      // width, so a slow drag doesn't flood the wire with near-identical dabs.
      if (lastSentUV) {
        const px = Math.hypot(uv.u - lastSentUV.u, uv.v - lastSentUV.v) * SURFACE_SIZE;
        if (px < Math.max(2, uv.radius * 0.35)) return;
      }
      emit(uv, true);
    };

    const onPointerUp = (e: PointerEvent) => {
      painting = false;
      orbiting = false;
      lastSentUV = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    const onPointerLeave = () => latest.current.onCursor(null);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Shift picks the brush; the wheel on its own stays the zoom it has
      // always been, which is what the left slider shows.
      if (e.shiftKey) latest.current.onBrushStep(-Math.sign(e.deltaY));
      else latest.current.onZoom(Math.sign(e.deltaY));
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      // Leaving paint mode has to take the ring with it; nothing else clears it.
      latest.current.onCursor(null);
    };
  }, [opts.active, gl, camera, scene]);
}
