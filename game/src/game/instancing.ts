import type { MapBox } from "./arena";

/**
 * Which boxes get drawn as GPU instances, decided as data.
 *
 * The renderer used to clone a full GLB scene graph per box — 600-odd clones,
 * each its own draw calls. Most of those boxes are the same handful of models
 * repeated, which is exactly what THREE.InstancedMesh exists for. The split
 * lives here, three.js-free, so check:map can pin the rule itself: any model
 * repeated at least INSTANCE_MIN times must take the instanced path, or a
 * future model quietly ships hundreds of clones again.
 *
 * Below the threshold instancing only adds bookkeeping — a two-off building
 * saves nothing worth the indirection.
 */
export const INSTANCE_MIN = 3;

export interface InstancingPlan {
  /** model id -> every box drawn with that model, in MAP_BOXES order. */
  instanced: Map<string, MapBox[]>;
  /** Boxes that stay individually placed models. */
  singles: MapBox[];
}

/**
 * Boxes that are drawn as models at all — everything except the perimeter
 * walls, which stay plain textured boxes, and slabs, which are structure
 * drawn as textured boxes too (a model fitted to a 4.6u deck would either
 * stretch or rattle around inside it).
 */
export function modelDrawn(boxes: MapBox[], wallHeight: number): MapBox[] {
  return boxes.filter((b) => !(b.wall && b.s[1] === wallHeight) && !b.slab && !b.roof);
}

export function instancingPlan(drawn: MapBox[]): InstancingPlan {
  const byModel = new Map<string, MapBox[]>();
  for (const b of drawn) {
    const id = b.family ?? "partition";
    const list = byModel.get(id);
    if (list) list.push(b);
    else byModel.set(id, [b]);
  }

  const instanced = new Map<string, MapBox[]>();
  const singles: MapBox[] = [];
  for (const [id, list] of byModel) {
    if (list.length >= INSTANCE_MIN) instanced.set(id, list);
    else singles.push(...list);
  }
  return { instanced, singles };
}
