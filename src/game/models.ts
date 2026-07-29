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
/**
 * City buildings are authored at about 2u. 2.5 makes them read as sheds you
 * walk around rather than city blocks — at 3.5 a single one covered a spawn
 * point and most of the gap between two zones.
 */
const CITY = 2.5;

export interface ModelSpec {
  url: string;
  /** Bounding box as authored, before `scale`. */
  native: [number, number, number];
  scale: number;
  /**
   * Whether the collider's footprint is squared off at the wider horizontal
   * axis.
   *
   * True for anything a player squeezes past, so "can I fit between these"
   * doesn't depend on which side you walk in from — and so a scattered prop can
   * be turned to any angle without its collider becoming a lie.
   *
   * False for buildings: they're placed by hand at known angles, and rounding a
   * 7u footprint up to a square would swallow metres of walkable floor.
   */
  squareFootprint: boolean;
}

export const MODELS = {
  // Survival's barrel is authored short and reads too squat at the kit scale,
  // so it takes half again on top of it.
  drum: {
    url: "/models/survival/barrel.glb",
    native: [0.236, 0.344, 0.236],
    scale: SURVIVAL * 1.5,
    squareFootprint: true,
  },
  crate: {
    url: "/models/survival/box-large.glb",
    native: [0.25, 0.25, 0.5],
    scale: SURVIVAL,
    squareFootprint: true,
  },
  pallet: {
    url: "/models/survival/resource-planks.glb",
    native: [0.373, 0.094, 0.626],
    scale: SURVIVAL,
    squareFootprint: true,
  },
  pillar: {
    url: "/models/factory/structure-tall.glb",
    native: [0.3, 2.0, 1.1],
    scale: FACTORY,
    squareFootprint: true,
  },
  partition: {
    url: "/models/factory/structure-tall.glb",
    native: [0.3, 2.0, 1.1],
    scale: FACTORY,
    squareFootprint: true,
  },

  // Landmarks. Big enough to navigate by, and none of them climbable.
  "building-a": {
    url: "/models/city/building-a.glb",
    native: [2.084, 1.47, 1.242],
    scale: CITY,
    squareFootprint: false,
  },
  "building-c": {
    url: "/models/city/building-c.glb",
    native: [1.876, 1.25, 2.108],
    scale: CITY,
    squareFootprint: false,
  },
  "building-l": {
    url: "/models/city/building-l.glb",
    native: [2.084, 1.925, 1.87],
    scale: CITY,
    squareFootprint: false,
  },
  "building-m": {
    url: "/models/city/building-m.glb",
    native: [1.316, 1.519, 1.7],
    scale: CITY,
    squareFootprint: false,
  },
  "building-r": {
    url: "/models/city/building-r.glb",
    native: [2.484, 1.393, 1.272],
    scale: CITY,
    squareFootprint: false,
  },
  tank: {
    url: "/models/city/detail-tank.glb",
    native: [0.848, 0.415, 0.515],
    scale: CITY,
    squareFootprint: true,
  },
  chimney: {
    url: "/models/city/chimney-large.glb",
    native: [1.0, 1.7, 1.0],
    scale: CITY * 0.7,
    squareFootprint: true,
  },
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODELS;

/** The collider a model needs: its scaled box, footprint squared off if asked. */
export function colliderFor(id: ModelId): [number, number, number] {
  const { native, scale, squareFootprint } = MODELS[id];
  const up = (v: number) => Math.ceil(v * scale * 100) / 100;
  if (squareFootprint) {
    const side = up(Math.max(native[0], native[2]));
    return [side, up(native[1]), side];
  }
  return [up(native[0]), up(native[1]), up(native[2])];
}
