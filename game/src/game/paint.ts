/**
 * Body paint.
 *
 * Each player owns one canvas that backs the material map of every body part.
 * Parts are UV-packed into cells of that single texture, so a whole player is
 * one texture and one material — eight players cost eight canvases, not fifty.
 *
 * Painting is a raycast hit -> UV -> soft radial blob drawn with Canvas2D. Only
 * the surface actually being painted is re-uploaded, and only while the brush
 * is down, so this stays cheap.
 */

import * as THREE from "three";

export const BODY_PARTS = ["head", "torso", "armL", "armR", "legL", "legR"] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

const GRID_COLS = 3;
const GRID_ROWS = 2;
export const SURFACE_SIZE = 512;
export const BASE_COLOR = 0xf4f4f4;

/** Cell each body part occupies in the shared texture. */
const PART_CELL: Record<BodyPart, [number, number]> = {
  head: [0, 0],
  torso: [1, 0],
  armL: [2, 0],
  armR: [0, 1],
  legL: [1, 1],
  legR: [2, 1],
};

/**
 * Rewrites a geometry's 0-1 UVs so they occupy one cell of the shared atlas.
 * Geometries are cloned per part before this runs — never share a geometry
 * between two parts or they'll fight over the same region.
 */
export function packUVs(geometry: THREE.BufferGeometry, part: BodyPart): void {
  const uv = geometry.attributes.uv;
  if (!uv) return;

  const [cx, cy] = PART_CELL[part];
  // Inset so bilinear filtering can't bleed paint between neighbouring cells.
  const pad = 0.015;

  for (let i = 0; i < uv.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    const v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
    uv.setXY(
      i,
      (cx + pad + u * (1 - pad * 2)) / GRID_COLS,
      (cy + pad + v * (1 - pad * 2)) / GRID_ROWS
    );
  }
  uv.needsUpdate = true;
}

export function hexToCss(color: number): string {
  return "#" + (color >>> 0).toString(16).padStart(6, "0");
}

/** One brush dab. Kept to four small numbers because these go over the wire. */
export interface PaintDab {
  /** UV across the whole shared texture, 0-1. */
  u: number;
  v: number;
  /** Radius in texture pixels — matches the BRUSH SIZE slider directly. */
  r: number;
  /** Packed 0xRRGGBB. */
  c: number;
}

export class PaintSurface {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;

  constructor(size = SURFACE_SIZE) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;

    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.clear();
  }

  clear(): void {
    this.ctx.fillStyle = hexToCss(BASE_COLOR);
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  /** Soft-edged dab, matching the airbrush look of the reference game. */
  dab({ u, v, r, c }: PaintDab): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const x = u * w;
    const y = (1 - v) * h; // canvas Y runs opposite to UV V
    const radius = Math.max(1.5, r);

    const css = hexToCss(c);
    const grad = this.ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius);
    grad.addColorStop(0, css);
    grad.addColorStop(0.65, css);
    grad.addColorStop(1, css + "00");

    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.texture.needsUpdate = true;
  }

  /** Interpolates between two points so fast drags don't leave gaps. */
  stroke(from: { u: number; v: number }, to: PaintDab): void {
    const w = this.canvas.width;
    const dist = Math.hypot((to.u - from.u) * w, (to.v - from.v) * w);
    const steps = Math.min(24, Math.max(1, Math.ceil(dist / (to.r * 0.4))));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.dab({ u: from.u + (to.u - from.u) * t, v: from.v + (to.v - from.v) * t, r: to.r, c: to.c });
    }
  }

  /** Floods every cell — backs the FILL tool. */
  fill(color: number): void {
    this.ctx.fillStyle = hexToCss(color);
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  /** Colour under a UV coordinate — backs the PICKER tool. */
  sample(u: number, v: number): number {
    const x = THREE.MathUtils.clamp(Math.floor(u * this.canvas.width), 0, this.canvas.width - 1);
    const y = THREE.MathUtils.clamp(
      Math.floor((1 - v) * this.canvas.height),
      0,
      this.canvas.height - 1
    );
    const d = this.ctx.getImageData(x, y, 1, 1).data;
    return (d[0] << 16) | (d[1] << 8) | d[2];
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** One surface per player account, so remote dabs can be replayed onto the right body. */
const surfaces = new Map<string, PaintSurface>();

export function surfaceFor(account: string): PaintSurface {
  let s = surfaces.get(account);
  if (!s) {
    s = new PaintSurface();
    surfaces.set(account, s);
  }
  return s;
}

export function clearSurface(account: string): void {
  surfaces.get(account)?.clear();
}

export function clearAllSurfaces(): void {
  for (const s of surfaces.values()) s.clear();
}

export function releaseSurface(account: string): void {
  surfaces.get(account)?.dispose();
  surfaces.delete(account);
}
