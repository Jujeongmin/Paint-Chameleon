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

export const GRID_COLS = 3;
export const GRID_ROWS = 2;
export const SURFACE_SIZE = 512;
export const BASE_COLOR = 0xf4f4f4;

/** Cell each body part occupies in the shared texture. */
export const PART_CELL: Record<BodyPart, [number, number]> = {
  head: [0, 0],
  torso: [1, 0],
  armL: [2, 0],
  armR: [0, 1],
  legL: [1, 1],
  legR: [2, 1],
};

/** Inset so bilinear filtering can't bleed paint between neighbouring cells. */
const CELL_PAD = 0.006;

/**
 * Every part here is a surface of revolution about Y — a sphere or a capsule —
 * so its vertices come in rings that share a v. This measures those rings:
 * how far it is along the outline from one end to the other, and how wide the
 * widest ring is.
 *
 * Returns null for anything that isn't shaped like that, or is degenerate.
 */
interface Meridian {
  /** Where a generator-assigned v sits along the outline, 0-1 by length. */
  at: (v: number) => number;
  /** Length of that outline in world units. */
  arcLength: number;
  /** Radius of the widest ring — the one the dab is made round on. */
  widest: number;
}

function meridian(geometry: THREE.BufferGeometry): Meridian | null {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  if (!pos || !uv) return null;

  // Ring key is the v the generator assigned, which is constant along a ring.
  const rings = new Map<number, { v: number; radius: number; y: number }>();
  for (let i = 0; i < uv.count; i++) {
    const v = uv.getY(i);
    const key = Math.round(v * 1e6);
    const radius = Math.hypot(pos.getX(i), pos.getZ(i));
    const found = rings.get(key);
    if (found) found.radius = Math.max(found.radius, radius);
    else rings.set(key, { v, radius, y: pos.getY(i) });
  }

  const ordered = [...rings.values()].sort((a, b) => a.v - b.v);
  if (ordered.length < 2) return null;

  // Walking the outline, not the axis: on a cap, most of the distance is
  // sideways, and measuring it along Y alone would squash the caps flat.
  const arc = [0];
  for (let i = 1; i < ordered.length; i++) {
    arc.push(
      arc[i - 1] +
        Math.hypot(ordered[i].radius - ordered[i - 1].radius, ordered[i].y - ordered[i - 1].y)
    );
  }

  const total = arc[arc.length - 1];
  const widest = ordered.reduce((most, r) => Math.max(most, r.radius), 0);
  if (!(total > 1e-9) || !(widest > 1e-9)) return null;

  // Rings are what the lookup is built from, but interpolate between them
  // anyway: a vertex whose v was nudged off its ring still lands somewhere
  // sensible instead of snapping to a neighbour.
  const at = (v: number): number => {
    if (v <= ordered[0].v) return 0;
    for (let i = 1; i < ordered.length; i++) {
      if (v <= ordered[i].v) {
        const span = ordered[i].v - ordered[i - 1].v;
        const t = span > 1e-12 ? (v - ordered[i - 1].v) / span : 0;
        return (arc[i - 1] + (arc[i] - arc[i - 1]) * t) / total;
      }
    }
    return 1;
  };

  return { at, arcLength: total, widest };
}

/**
 * Rewrites a geometry's 0-1 UVs so they occupy one cell of the shared atlas.
 * Geometries are cloned per part before this runs — never share a geometry
 * between two parts or they'll fight over the same region.
 *
 * A dab is a circle drawn in texture space, so it only lands on the body as a
 * circle if a texel is the same size in both directions there. Two things
 * would otherwise stop that, and both are handled here:
 *
 *  1. `CapsuleGeometry` is built on `LatheGeometry`, which spreads v evenly
 *     over the outline's POINTS rather than its length. The straight side of
 *     the capsule is a single segment between the two caps, so the long flank
 *     of a limb — most of its surface — was being squeezed into a ninth of the
 *     cell's height. Measured before this: a dab on the stick avatar's arm came
 *     out 11 times wider than it was tall. So v is re-spread by arc length.
 *  2. A cell is a fixed 1/3 by 1/2 of the texture, and no part is that shape:
 *     a head's circumference is twice its meridian, a limb's is much less. So
 *     the part's rect is fitted inside its cell at the part's own aspect and
 *     centred, leaving the rest of the cell unpainted. That costs resolution —
 *     a head uses about a third of its cell — which is the price of the dab
 *     being round, at an unchanged SURFACE_SIZE.
 *
 * What is left over is the sphere's own doing: no map of a sphere is
 * distortion-free, so rings away from the widest one still compress. check:paint
 * pins how much, against limits derived from that unavoidable amount.
 */
export function packUVs(geometry: THREE.BufferGeometry, part: BodyPart): void {
  const uv = geometry.attributes.uv;
  if (!uv) return;

  const [cx, cy] = PART_CELL[part];
  const cellU = 1 / GRID_COLS;
  const cellV = 1 / GRID_ROWS;

  const shape = meridian(geometry);

  // Texels are square, so making a texel the same size in world units along u
  // as along v is the same as making uv-per-world match: the texture's
  // resolution cancels out of the ratio, and nothing here has to know it.
  let fitU = cellU - CELL_PAD * 2;
  let fitV = cellV - CELL_PAD * 2;
  if (shape) {
    const circumference = 2 * Math.PI * shape.widest;
    const scale = Math.min(fitU / circumference, fitV / shape.arcLength);
    fitU = circumference * scale;
    fitV = shape.arcLength * scale;
  }

  const originU = cx * cellU + (cellU - fitU) / 2;
  const originV = cy * cellV + (cellV - fitV) / 2;

  for (let i = 0; i < uv.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    const v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
    const along = shape ? shape.at(v) : v;
    uv.setXY(i, originU + u * fitU, originV + along * fitV);
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

/**
 * Where a joined stroke actually puts paint, given the previous dab and the
 * new one. Excludes the starting point (already painted) and includes the end.
 *
 * Pure, and separate from the canvas, because everything worth checking about
 * a stroke is the choice of points — and a canvas needs a DOM the check
 * scripts don't have.
 */
export function strokeSteps(
  from: { u: number; v: number },
  to: PaintDab,
  size = SURFACE_SIZE
): { u: number; v: number }[] {
  // Interpolating is only meaningful while both ends are on the same piece of
  // surface. The atlas puts six parts side by side, so a straight line drawn
  // in it between two of them crosses whatever cells lie in between and paints
  // parts the pointer never went near — an arm-to-arm sweep leaves a stripe
  // down the torso and a leg. And within one cell, a capsule's u runs all the
  // way around the limb, so the two ends of a drag that crossed the seam sit
  // at opposite edges of the cell with the entire limb between them.
  //
  // Both look the same from here: the gap is too big to be one stroke. The
  // cost is a gap at the seam instead of a band across the limb — paint from
  // one side does not carry round to the other. Wrapping the interpolation
  // through the seam would be the fuller answer, but it needs to know where
  // this part's uv rect starts and ends, which is packUVs' business and does
  // not survive the trip over the wire.
  const sameCell =
    Math.floor(from.u * GRID_COLS) === Math.floor(to.u * GRID_COLS) &&
    Math.floor(from.v * GRID_ROWS) === Math.floor(to.v * GRID_ROWS);
  const nearEnough =
    Math.abs(to.u - from.u) <= 0.5 / GRID_COLS && Math.abs(to.v - from.v) <= 0.5 / GRID_ROWS;
  if (!sameCell || !nearEnough) return [{ u: to.u, v: to.v }];

  const dist = Math.hypot((to.u - from.u) * size, (to.v - from.v) * size);
  const steps = Math.min(24, Math.max(1, Math.ceil(dist / (to.r * 0.4))));

  const points: { u: number; v: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({ u: from.u + (to.u - from.u) * t, v: from.v + (to.v - from.v) * t });
  }
  return points;
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
    for (const point of strokeSteps(from, to, this.canvas.width)) {
      this.dab({ u: point.u, v: point.v, r: to.r, c: to.c });
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
