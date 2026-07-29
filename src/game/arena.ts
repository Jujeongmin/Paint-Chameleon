/**
 * The arena's contents — the geometry itself. Collision lives in map.ts.
 *
 * The dependency runs one way only: map.ts → arena.ts. Nothing here imports a
 * collision helper, so there is no cycle.
 *
 * buildMap() is still duplicated verbatim in server/src/rules.ts. Change the
 * generator here and you must change it there, or players will walk around one
 * arena while the server spawns them into another.
 */

export interface MapBox {
  p: [number, number, number]; // center
  s: [number, number, number]; // full size
  c: number; // hex color
}

export const ARENA = { size: 44, wallHeight: 7, wallThickness: 1 };
export const FLOOR_COLOR = 0x3a3f4a;
export const WALL_COLOR = 0x7a7d85;
export const MAP_SEED = 20260723;

/** mulberry32 — small, deterministic, identical on client and server. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Color regions. A hider has to commit to one region's palette to blend in. */
const CLUSTERS: { center: [number, number]; radius: number; colors: number[]; count: number }[] = [
  { center: [-13, -13], radius: 6.5, colors: [0xc75b39, 0xe08a5f], count: 9 }, // rust crates
  { center: [13, -13], radius: 6.5, colors: [0x2f8f8a, 0x49b3ad], count: 9 }, // teal barrels
  { center: [-13, 13], radius: 6.5, colors: [0x6b4e9e, 0x9179c4], count: 8 }, // purple shelves
  { center: [13, 13], radius: 6.5, colors: [0x4a8b3c, 0x6fbf5c], count: 8 }, // green blocks
  { center: [0, 0], radius: 5.5, colors: [0xd4a53f, 0xe8c66b], count: 7 }, // yellow pallets
  { center: [0, -16], radius: 4.0, colors: [0x7a7d85, 0xb0b3ba], count: 4 }, // concrete
  { center: [0, 16], radius: 4.0, colors: [0x7a7d85, 0xb0b3ba], count: 4 },
];

export function buildMap(): MapBox[] {
  const boxes: MapBox[] = [];
  const half = ARENA.size / 2;
  const t = ARENA.wallThickness;
  const wy = ARENA.wallHeight / 2;

  // Perimeter walls.
  boxes.push({ p: [0, wy, -half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR });
  boxes.push({ p: [0, wy, half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR });
  boxes.push({ p: [-half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR });
  boxes.push({ p: [half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR });

  const rand = rng(MAP_SEED);
  for (const cl of CLUSTERS) {
    for (let i = 0; i < cl.count; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * cl.radius;
      const x = cl.center[0] + Math.cos(ang) * dist;
      const z = cl.center[1] + Math.sin(ang) * dist;
      const w = 1.2 + rand() * 2.4;
      const d = 1.2 + rand() * 2.4;
      const h = 0.9 + rand() * 2.8;
      const c = cl.colors[Math.floor(rand() * cl.colors.length)];
      boxes.push({ p: [x, h / 2, z], s: [w, h, d], c });
    }
  }
  return boxes;
}

export const MAP_BOXES: MapBox[] = buildMap();

/**
 * Where hiders start. Hand-picked, for two reasons.
 *
 * The only thing the server ever needed the map for was "find a spot that
 * isn't inside geometry". Given this list it needs no boxes at all, which
 * removes the largest duplication in the project — and a hand-designed map
 * would otherwise mean ~90 box literals living in two places.
 *
 * A random open spot only guarantees the spot is empty. A chosen one also
 * guarantees you don't begin the round already standing in the best hiding
 * slot on the map.
 *
 * The seeker is pinned to [0,0,0] by server.ts and is not in this list.
 * KEEP IN SYNC WITH server/src/rules.ts — check:sync compares them.
 */
export const SPAWN_POINTS: [number, number][] = [
  [-17, -17], [-17, 0], [-17, 18],
  [0, -17], [0, 17],
  [17, -17], [17, 0], [17, 17],
  [-9, -19], [8, -19], [-10, 19], [9, 19],
];
