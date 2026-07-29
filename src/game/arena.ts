/**
 * The arena's contents — the geometry itself. Collision lives in map.ts.
 *
 * The dependency runs one way only: map.ts → arena.ts. Nothing here imports a
 * collision helper, so there is no cycle.
 *
 * The map is hand-designed, not generated: hiding places have to be placed,
 * and a scatter of random boxes only ever produces them by accident.
 * check:map is what says whether the layout came out right.
 *
 * Boxes here are collision, not appearance — props.tsx draws a model in each
 * one's place. They were originally sized to pose silhouettes so a painted
 * player could pass for a prop; that mimicry was dropped in favour of models
 * you can't paint to match, so the dimensions below now answer a plainer
 * question: what must you do to get past this thing.
 */

import { colliderFor } from "./models";

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
  /** Which family's model to draw here. Absent on structure. */
  family?: string;
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

/** A prop family: one collision size and the colour it reads as. */
export interface Family {
  id: string;
  /** [width, height, depth] — the collider. props.tsx fits a model to it. */
  box: [number, number, number];
  /**
   * What the eyedropper returns for this family, and the tint alternated down
   * a row. The models carry their own texture atlas, so this no longer decides
   * what you see — but a picked colour still has to be something.
   */
  colors: [number, number];
}

/**
 * Sizes come from the models, not the other way round — see models.ts. What
 * that lands on, and what it means for movement:
 *
 *   pallet  0.25  under STEP_HEIGHT 0.45 — walked over
 *   crate   0.65  over the step, under the 1.6945 a jump reaches — climbed
 *   drum    0.90  likewise climbable, but tall enough to crouch behind
 *   pillar  2.00  over both, and over eye height 1.5 — blocks sight as well
 *
 * check:map asserts all three rungs still exist, which is the only claim these
 * numbers have to make now that props are no longer sized to imitate a pose.
 */
export const FAMILIES: Family[] = [
  { id: "drum", box: colliderFor("drum"), colors: [0xc75b39, 0xe08a5f] },
  { id: "crate", box: colliderFor("crate"), colors: [0x6b4e9e, 0x9179c4] },
  { id: "pallet", box: colliderFor("pallet"), colors: [0xd4a53f, 0xe8c66b] },
  { id: "pillar", box: colliderFor("pillar"), colors: [0x2f8f8a, 0x49b3ad] },
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

/**
 * Three clusters per zone, one zone per quadrant, one family each.
 *
 * Spacing is chosen per family so the gap between neighbours (spacing minus the
 * box) stays under the player's 0.9 diameter while the missing slot stays over
 * their 0.45 radius. That pair of inequalities is what makes the empty slot the
 * only enterable spot in a row.
 *
 * Coordinates were settled by running check:map, not by eye.
 */
export const CLUSTERS: Cluster[] = [
  // Drums, north-west.
  { family: "drum", at: [-17, -16], axis: "x", count: 6, emptyIndex: 3, spacing: 1.3 },
  { family: "drum", at: [-18, -14], axis: "z", count: 4, emptyIndex: 2, spacing: 1.3 },
  { family: "drum", at: [-9.5, -18.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.3 },

  // Pallets, north-east. Walk-over, so a row of them reads as floor pattern
  // rather than as a wall, and the cover they give is only from lying on one.
  { family: "pallet", at: [9, -16], axis: "x", count: 5, emptyIndex: 2, spacing: 1.9 },
  { family: "pallet", at: [17, -15], axis: "z", count: 4, emptyIndex: 1, spacing: 1.9 },
  { family: "pallet", at: [10, -9], axis: "x", count: 4, emptyIndex: 2, spacing: 1.9 },

  // Crates, south-west. Chest-high and the easiest thing to get on top of.
  { family: "crate", at: [-16, 10], axis: "x", count: 5, emptyIndex: 2, spacing: 1.7 },
  { family: "crate", at: [-17, 12.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.7 },
  { family: "crate", at: [-10, 13], axis: "z", count: 4, emptyIndex: 2, spacing: 1.7 },

  // Pillars, south-east. Tallest props; they break sightlines inside the zone.
  { family: "pillar", at: [9, 10], axis: "x", count: 5, emptyIndex: 2, spacing: 1.6 },
  { family: "pillar", at: [17.5, 12.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.6 },
  { family: "pillar", at: [10, 13.5], axis: "z", count: 4, emptyIndex: 2, spacing: 1.6 },
];

/**
 * Partitions, laid out as a pinwheel: one arm per quadrant, rotated four ways.
 *
 * The panel model is 2.0 tall, which clears both thresholds it has to: above
 * the 1.69 a jump can mount, so a partition can't be climbed, and above
 * CAMERA.eyeHeight 1.5, so it can't be seen over from standing.
 *
 * Each arm leaves its MIDDLE open rather than its end. An open end turns the
 * arena into a ring you have to run around, which makes a chase tedious; an
 * open middle lets you walk straight in while still cutting the sightline from
 * the crossroads, which is the property check:map enforces.
 *
 * Written as axis-aligned segments [x1, z1, x2, z2].
 */
const PARTITIONS: [number, number, number, number][] = [
  [-19, -6, -13, -6],
  [-7, -6, -1, -6],
  [6, -19, 6, -13],
  [6, -7, 6, -1],
  [19, 6, 13, 6],
  [7, 6, 1, 6],
  [-6, 19, -6, 13],
  [-6, 7, -6, 1],
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

  // Each arm is a run of panels rather than one long box, so the model can be
  // repeated at its own size instead of stretched down the whole span.
  const panel = colliderFor("partition");
  for (const [x1, z1, x2, z2] of PARTITIONS) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.max(1, Math.round(length / panel[0]));
    for (let i = 0; i < count; i++) {
      // Centres spread evenly along the segment, half a panel in from each end.
      const t = (i + 0.5) / count;
      boxes.push({
        p: [x1 + (x2 - x1) * t, panel[1] / 2, z1 + (z2 - z1) * t],
        s: [...panel] as [number, number, number],
        c: WALL_COLOR,
        wall: true,
        family: "partition",
      });
    }
  }

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
        family: f.id,
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
  [-17, -17], [-17, 0], [-17, 19],
  [0, -17], [0, 17],
  [17, -17], [17, 0], [16, 17],
  [-7, -19], [8, -19], [-12, 19], [8, 19],
];
