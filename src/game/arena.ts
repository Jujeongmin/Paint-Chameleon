/**
 * The arena's contents — the geometry itself. Collision lives in map.ts.
 *
 * The dependency runs one way only: map.ts → arena.ts. Nothing here imports a
 * collision helper, so there is no cycle.
 *
 * The map is hand-designed, not generated. Hiding in this game means passing
 * for a prop, and that only works if props come in rows of identical objects
 * sized to a pose's silhouette — which a scatter of random boxes can never be.
 * check:map is what says whether the layout came out right.
 */

import { TOP_Y } from "./bodies";
import { maxPoseSize } from "./poseBounds";
import { STAND_POSE } from "./constants";

export interface MapBox {
  p: [number, number, number]; // center
  s: [number, number, number]; // full size
  c: number; // hex color
  /**
   * Structure — perimeter walls and partitions — as opposed to a prop.
   *
   * Only structure gets a photographic texture. Props are what a hider paints
   * themselves to imitate, and a player can only paint flat colours, so a
   * textured prop is one nobody can match.
   */
  wall?: true;
}

export const ARENA = { size: 44, wallHeight: 7, wallThickness: 1 };

/**
 * What the floor and walls read as to the eyedropper.
 *
 * These are the average tone of the texture on each surface, not a colour the
 * renderer applies — the textured materials draw with a white base so the map
 * isn't tinted twice. They matter because they are the closest a hider can get
 * to those surfaces with flat paint, so re-measure them whenever the textures
 * change (public/README.md says how).
 */
export const FLOOR_COLOR = 0x908773;
export const WALL_COLOR = 0x9a9b9e;

/** A prop family. Its box is sized to the silhouette of one pose. */
export interface Family {
  id: string;
  /** [width, height, depth] */
  box: [number, number, number];
  /** Two tones. A single flat colour makes any imperfect paint job obvious. */
  colors: [number, number];
}

/** Round up to the centimetre — props shouldn't carry fifteen decimal places. */
function cm(v: number): number {
  return Math.ceil(v * 100) / 100;
}

/**
 * Standing silhouette, measured rather than guessed: 0.986 wide, 0.800 deep,
 * crown at TOP_Y. The footprint is squared off at the wider of the two because
 * the body turns with the player, so depth becomes width at a quarter turn —
 * and a real drum is round anyway.
 *
 * Height is TOP_Y exactly. check:bodies asserts the standing silhouette's top
 * lands on TOP_Y, so this is a relationship rather than a coincidence: a drum
 * is exactly as tall as the tallest thing that can stand next to it.
 */
const DRUM_SIDE = cm(Math.max(maxPoseSize(STAND_POSE).width, maxPoseSize(STAND_POSE).depth));

export const FAMILIES: Family[] = [
  { id: "drum", box: [DRUM_SIDE, TOP_Y, DRUM_SIDE], colors: [0xc75b39, 0xe08a5f] },
];

/**
 * One cluster is a row of props with one slot deliberately left empty.
 *
 * The gap between props (spacing minus the box) is too narrow for a player to
 * enter. The empty slot is the only place in the row you can stand, and that
 * is the whole definition of a designed hiding place here.
 */
export interface Cluster {
  family: string;
  /** Centre of the first prop. */
  at: [number, number];
  axis: "x" | "z";
  count: number;
  /** Which index, 0..count-1, to leave out. */
  emptyIndex: number;
  spacing: number;
}

export const CLUSTERS: Cluster[] = [
  { family: "drum", at: [-17, -16], axis: "x", count: 6, emptyIndex: 3, spacing: 1.5 },
  { family: "drum", at: [-18, -14], axis: "z", count: 4, emptyIndex: 2, spacing: 1.5 },
  { family: "drum", at: [-9.5, -18.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.5 },
];

/** Centre of a cluster's empty slot. check:map asserts things about this point. */
export function slotOf(c: Cluster): [number, number] {
  const d = c.emptyIndex * c.spacing;
  return c.axis === "x" ? [c.at[0] + d, c.at[1]] : [c.at[0], c.at[1] + d];
}

function familyOf(id: string): Family {
  const f = FAMILIES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown family: ${id}`);
  return f;
}

export function buildArena(): MapBox[] {
  const boxes: MapBox[] = [];
  const half = ARENA.size / 2;
  const t = ARENA.wallThickness;
  const wy = ARENA.wallHeight / 2;

  // Perimeter walls.
  boxes.push({ p: [0, wy, -half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR, wall: true });
  boxes.push({ p: [0, wy, half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR, wall: true });
  boxes.push({ p: [-half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR, wall: true });
  boxes.push({ p: [half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR, wall: true });

  for (const c of CLUSTERS) {
    const f = familyOf(c.family);
    for (let i = 0; i < c.count; i++) {
      if (i === c.emptyIndex) continue;
      const d = i * c.spacing;
      const x = c.axis === "x" ? c.at[0] + d : c.at[0];
      const z = c.axis === "z" ? c.at[1] + d : c.at[1];
      boxes.push({
        p: [x, f.box[1] / 2, z],
        s: [...f.box] as [number, number, number],
        // Alternate the two tones: the row has to already contain variation,
        // or a hider's approximate paint job is the one odd item in it.
        c: f.colors[i % 2],
      });
    }
  }

  return boxes;
}

export const MAP_BOXES: MapBox[] = buildArena();

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
  [-7, -19], [8, -19], [-10, 19], [9, 19],
];
