/**
 * The models the arena is built from, and the size each one really is.
 *
 * Pure data, no three.js: arena.ts derives its colliders from these numbers and
 * the check scripts import it without a renderer.
 *
 * `native` is the model's own bounding box, measured out of the .glb by
 * `npm run glb:size`. Re-run it after changing a model — a stale number here
 * means the collider and the thing you can see disagree.
 *
 * Every model is scaled UNIFORMLY. An earlier version stretched each model to
 * fill its collider, which fit exactly and looked wrong: a barrel as tall as a
 * person is a barrel nobody believes. Keeping the proportions costs a small gap
 * on the narrower horizontal axis, because colliders are square-footed to keep
 * the row spacing arithmetic honest, and that gap is the better trade.
 *
 * The scale is per kit rather than per model, so objects from the same kit stay
 * the right size relative to each other. Kenney authors kits at wildly
 * different scales — Survival's barrel is 0.34 tall, Factory's wall is 3.0 —
 * so one global number would not work.
 */

/** Survival is authored small; 2.6 puts its barrel at a believable 0.9m. */
const SURVIVAL = 2.6;
/** Factory is already authored at roughly one unit per metre. */
const FACTORY = 1;

export interface ModelSpec {
  url: string;
  /** Bounding box as authored, before `scale`. */
  native: [number, number, number];
  scale: number;
}

export const MODELS = {
  drum: { url: "/models/survival/barrel.glb", native: [0.236, 0.344, 0.236], scale: SURVIVAL },
  crate: { url: "/models/survival/box-large.glb", native: [0.25, 0.25, 0.5], scale: SURVIVAL },
  pallet: {
    url: "/models/survival/resource-planks.glb",
    native: [0.373, 0.094, 0.626],
    scale: SURVIVAL,
  },
  pillar: { url: "/models/factory/structure-tall.glb", native: [0.3, 2.0, 1.1], scale: FACTORY },
  partition: { url: "/models/factory/structure-tall.glb", native: [0.3, 2.0, 1.1], scale: FACTORY },
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODELS;

/**
 * The collider for a model: its scaled height, and a square footprint taking
 * the wider of the two horizontal axes.
 *
 * Square, because a prop turns no more than the row it sits in but the player
 * walks at it from any angle, and a rectangular footprint would make "can I fit
 * between these" depend on which side you approach from.
 */
export function colliderFor(id: ModelId): [number, number, number] {
  const { native, scale } = MODELS[id];
  const side = Math.ceil(Math.max(native[0], native[2]) * scale * 100) / 100;
  const height = Math.ceil(native[1] * scale * 100) / 100;
  return [side, height, side];
}
