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
 * Heights are chosen against the movement thresholds, which is the only thing
 * they still have to answer to:
 *
 *   pallet  0.40  under STEP_HEIGHT 0.45 — walked over
 *   crate   1.19  over the step, under the 1.6945 a jump reaches — climbed
 *   drum    1.86  over both — solid cover
 *   pillar  2.04  over both, and over eye height — blocks sight as well
 *
 * check:map asserts all three rungs exist. The numbers are the pose-silhouette
 * measurements they inherited from the mimicry design, kept because they were
 * already spaced correctly across the thresholds, not because the disguise
 * still depends on them.
 */
export const FAMILIES: Family[] = [
  { id: "drum", box: [0.99, 1.86, 0.99], colors: [0xc75b39, 0xe08a5f] },
  { id: "crate", box: [1.12, 1.19, 1.12], colors: [0x6b4e9e, 0x9179c4] },
  { id: "pallet", box: [1.64, 0.4, 1.64], colors: [0xd4a53f, 0xe8c66b] },
  { id: "pillar", box: [1.27, 2.04, 1.27], colors: [0x2f8f8a, 0x49b3ad] },
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
  // Drums, north-west. The zone the mimicry gate was judged on.
  { family: "drum", at: [-17, -16], axis: "x", count: 6, emptyIndex: 3, spacing: 1.5 },
  { family: "drum", at: [-18, -14], axis: "z", count: 4, emptyIndex: 2, spacing: 1.5 },
  { family: "drum", at: [-9.5, -18.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.5 },

  // Pallets, north-east. Walk-over, so a row of them is a floor pattern rather
  // than a wall — the disguise here is lying on one, not standing in the gap.
  { family: "pallet", at: [9, -16], axis: "x", count: 5, emptyIndex: 2, spacing: 1.8 },
  { family: "pallet", at: [17, -15], axis: "z", count: 4, emptyIndex: 1, spacing: 1.8 },
  { family: "pallet", at: [10, -9], axis: "x", count: 4, emptyIndex: 2, spacing: 1.8 },

  // Crates, south-west. The only family you can jump on top of.
  { family: "crate", at: [-16, 10], axis: "x", count: 5, emptyIndex: 2, spacing: 1.6 },
  { family: "crate", at: [-17, 12.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.6 },
  { family: "crate", at: [-10, 13], axis: "z", count: 4, emptyIndex: 2, spacing: 1.6 },

  // Pillars, south-east. Tallest props; they break sightlines inside the zone.
  { family: "pillar", at: [9, 10], axis: "x", count: 5, emptyIndex: 2, spacing: 1.75 },
  { family: "pillar", at: [17.5, 12.5], axis: "z", count: 4, emptyIndex: 1, spacing: 1.75 },
  { family: "pillar", at: [10, 13.5], axis: "z", count: 4, emptyIndex: 2, spacing: 1.75 },
];

/**
 * Partitions, laid out as a pinwheel: one arm per quadrant, rotated four ways.
 *
 * 2.4 satisfies two constraints at once. It is above the 1.69 a jump can mount,
 * so a partition can't be climbed, and above CAMERA.eyeHeight 1.5, so it can't
 * be seen over from standing.
 *
 * Each arm leaves its MIDDLE open rather than its end. An open end turns the
 * arena into a ring you have to run around, which makes a chase tedious; an
 * open middle lets you walk straight in while still cutting the sightline from
 * the crossroads, which is the property check:map enforces.
 *
 * Written as axis-aligned segments [x1, z1, x2, z2].
 */
const PARTITION_HEIGHT = 2.4;
const PARTITION_THICKNESS = 0.6;

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

  for (const [x1, z1, x2, z2] of PARTITIONS) {
    boxes.push({
      p: [(x1 + x2) / 2, PARTITION_HEIGHT / 2, (z1 + z2) / 2],
      s: [
        Math.abs(x2 - x1) || PARTITION_THICKNESS,
        PARTITION_HEIGHT,
        Math.abs(z2 - z1) || PARTITION_THICKNESS,
      ],
      c: WALL_COLOR,
      wall: true,
    });
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
  [-7, -19], [8, -19], [-10, 19], [8, 19],
];
