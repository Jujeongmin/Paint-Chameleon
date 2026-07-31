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

import { colliderFor, type ModelId } from "./models";

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
  /** Which model to draw here. Absent means the partition panel. */
  family?: string;
  /**
   * Drawn as a plain textured box rather than a fitted model — the platform
   * decks. A model is placed at its own scale inside its collider, and no
   * model in the kit is deck-shaped: fitting one would either stretch it past
   * recognition or leave it rattling around inside the box it must exactly
   * fill, and a deck you stand on has to LOOK like the box you stand on.
   */
  slab?: true;
  /**
   * Yaw for the model only — the collider stays axis-aligned.
   *
   * Safe because everything that gets turned has a square footprint, so the
   * box it claims is the same at any angle.
   */
  rotY?: number;
}

/**
 * 88x88 — four times the floor of the 44x44 it started as.
 *
 * The diagonal is now 124u, about 21 seconds at the hider's 6u/s, so the
 * seeker's 90 seconds buys far fewer sweeps than it used to. That is a balance
 * question this file can't answer; PHASE_SECONDS is where it would be settled.
 *
 * KEEP IN SYNC WITH server/src/rules.ts — check:sync compares it.
 */
export const ARENA = { size: 88, wallHeight: 7, wallThickness: 1 };

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
  // Drums, north-west. Outer trio, then a second one nearer the crossroads —
  // at 88x88 a single trio per zone leaves the middle half of each quadrant
  // with nothing designed in it at all.
  { family: "drum", at: [-34, -32], axis: "x", count: 6, emptyIndex: 3, spacing: 1.3 },
  { family: "drum", at: [-36, -28], axis: "z", count: 4, emptyIndex: 2, spacing: 1.3 },
  { family: "drum", at: [-19, -37], axis: "z", count: 4, emptyIndex: 1, spacing: 1.3 },
  { family: "drum", at: [-26, -20], axis: "x", count: 5, emptyIndex: 2, spacing: 1.3 },
  { family: "drum", at: [-20, -26], axis: "z", count: 4, emptyIndex: 1, spacing: 1.3 },
  { family: "drum", at: [-30, -14], axis: "x", count: 4, emptyIndex: 2, spacing: 1.3 },

  // Pallets, north-east. Walk-over, so a row of them reads as floor pattern
  // rather than as a wall, and the cover they give is only from lying on one.
  { family: "pallet", at: [18, -32], axis: "x", count: 5, emptyIndex: 2, spacing: 1.9 },
  { family: "pallet", at: [34, -30], axis: "z", count: 4, emptyIndex: 1, spacing: 1.9 },
  { family: "pallet", at: [20, -18], axis: "x", count: 4, emptyIndex: 2, spacing: 1.9 },
  { family: "pallet", at: [22, -24], axis: "x", count: 5, emptyIndex: 2, spacing: 1.9 },
  { family: "pallet", at: [32, -16], axis: "z", count: 4, emptyIndex: 1, spacing: 1.9 },
  { family: "pallet", at: [16, -12], axis: "x", count: 4, emptyIndex: 2, spacing: 1.9 },

  // Crates, south-west. Chest-high and the easiest thing to get on top of.
  { family: "crate", at: [-32, 20], axis: "x", count: 5, emptyIndex: 2, spacing: 1.7 },
  { family: "crate", at: [-34, 25], axis: "z", count: 4, emptyIndex: 1, spacing: 1.7 },
  { family: "crate", at: [-20, 26], axis: "z", count: 4, emptyIndex: 2, spacing: 1.7 },
  { family: "crate", at: [-24, 14], axis: "x", count: 5, emptyIndex: 2, spacing: 1.7 },
  { family: "crate", at: [-16, 20], axis: "z", count: 4, emptyIndex: 1, spacing: 1.7 },
  { family: "crate", at: [-30, 12], axis: "x", count: 4, emptyIndex: 2, spacing: 1.7 },

  // Pillars, south-east. Tallest props; they break sightlines inside the zone.
  { family: "pillar", at: [18, 20], axis: "x", count: 5, emptyIndex: 2, spacing: 1.6 },
  { family: "pillar", at: [35, 25], axis: "z", count: 4, emptyIndex: 1, spacing: 1.6 },
  { family: "pillar", at: [20, 27], axis: "z", count: 4, emptyIndex: 2, spacing: 1.6 },
  { family: "pillar", at: [24, 14], axis: "x", count: 5, emptyIndex: 2, spacing: 1.6 },
  { family: "pillar", at: [16, 22], axis: "z", count: 4, emptyIndex: 1, spacing: 1.6 },
  { family: "pillar", at: [30, 18], axis: "x", count: 4, emptyIndex: 2, spacing: 1.6 },
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
  [-38, -12, -26, -12],
  [-14, -12, -2, -12],
  [12, -38, 12, -26],
  [12, -14, 12, -2],
  [38, 12, 26, 12],
  [14, 12, 2, 12],
  [-12, 38, -12, 26],
  [-12, 14, -12, 2],
];

/**
 * Where hiders start. Hand-picked, for two reasons.
 *
 * The only thing the server ever needed the map for was "find a spot that
 * isn't inside geometry". Given this list it needs no boxes at all, which
 * removes the largest duplication in the project — and a hand-designed map
 * would otherwise mean ~200 box literals living in two places.
 *
 * A random open spot only guarantees the spot is empty. A chosen one also
 * guarantees you don't begin the round already standing in the best hiding
 * slot on the map. buildArena reads this list to keep clutter off them, which
 * is also why it is declared above the builder rather than below it.
 *
 * The seeker is pinned to [0,0,0] by server.ts and is not in this list.
 * KEEP IN SYNC WITH server/src/rules.ts — check:sync compares them.
 */
export const SPAWN_POINTS: [number, number][] = [
  [-34, -34], [-34, 0], [-34, 38],
  [0, -34], [0, 34],
  [34, -34], [34, 0], [32, 34],
  [-14, -38], [16, -38], [-24, 38], [16, 38],
];

/**
 * Landmarks. Hand-placed, because their job is to tell you where on the map
 * you are, and something you can navigate by cannot be randomly positioned.
 *
 * They sit between the zones rather than inside them, so they break up the long
 * empty runs without eating the rows.
 */
const BUILDINGS: { model: ModelId; at: [number, number]; rotY?: number }[] = [
  { model: "building-l", at: [-24, 6] },
  { model: "building-c", at: [24, -6], rotY: Math.PI / 2 },
  { model: "building-r", at: [6, 24], rotY: Math.PI / 2 },
  { model: "building-m", at: [-6, -24] },
  { model: "building-a", at: [-30, -8], rotY: Math.PI / 2 },
  { model: "building-m", at: [30, 8], rotY: Math.PI },
  { model: "building-l", at: [8, -30] },
  { model: "building-c", at: [-8, 30] },
];

/**
 * Watchtower platforms — the arena's only second storey.
 *
 * One per quadrant. A deck on pillar legs, reached by a stair of crate stacks
 * rising a crate's height (0.65) per step: under the 1.24 a jump reaches, so
 * every step is jumpable, and the last rise onto the deck is under the 0.45
 * STEP_HEIGHT, so it is simply walked. Nothing here invents a new movement
 * rule — the stair is made of the same boxes the rest of the arena teaches.
 *
 * Everything is sized for the giant: each step is two crates side by side
 * (about 2.6u across) and the deck is DECK_SIZE square, so the 0.9-radius
 * seeker climbs the same stair a hider does. That is the design's one hard
 * rule — a perch the seeker cannot follow to is a place the game cannot end —
 * and check:map drives the real integrator up every climb route at BOTH radii
 * to hold it.
 */
export interface Platform {
  id: string;
  /** Deck centre. */
  at: [number, number];
  /** Which side the stair descends toward: the sign and axis of approach. */
  from: "+x" | "-x" | "+z" | "-z";
}

/**
 * Deck top surface height. Above every prop family (tallest is 2.0), and the
 * last rise from the third tread (3 crates, 1.95) is 0.40 — strictly under
 * STEP_HEIGHT 0.45 rather than exactly on it, because a boundary value walks
 * or doesn't depending on which side of a <= someone wrote.
 */
export const DECK_TOP = 2.35;
export const DECK_SIZE = 4.6;
const DECK_THICKNESS = 0.4;

export const PLATFORMS: Platform[] = [
  // Positions dodge the cluster slots — a stair tread parked on a designed
  // hiding slot fails check:map's "the slot is empty", which is how the first
  // placement of these was caught.
  { id: "nw", at: [-24, -24], from: "-x" },
  { id: "ne", at: [30, -30], from: "-x" },
  { id: "sw", at: [-28, 28], from: "+z" },
  { id: "se", at: [26, 24], from: "+z" },
];

/** Unit vector of a Platform's `from` side. */
function sideOf(from: Platform["from"]): [number, number] {
  switch (from) {
    case "+x": return [1, 0];
    case "-x": return [-1, 0];
    case "+z": return [0, 1];
    default: return [0, -1];
  }
}

/**
 * The stair's tread positions, lowest first, plus the deck centre last — which
 * is also the climb route check:map replays with the physics integrator, for
 * a hider's radius and the seeker's. The y of each entry is the surface you
 * stand on when you get there; the check only asserts the last one.
 */
export function climbRoute(p: Platform): { x: number; z: number; top: number }[] {
  const crate = colliderFor("crate");
  const [dx, dz] = sideOf(p.from);
  const edge = DECK_SIZE / 2;
  const out: { x: number; z: number; top: number }[] = [];

  // Three tread levels: 1, 2 and 3 crates tall — the lowest is the farthest
  // out, so pushing in level order lists the route ground-first. (An earlier
  // unshift here listed the tallest tread first, and the climb check walked
  // the stair backwards.)
  for (let level = 1; level <= 3; level++) {
    const distance = edge + crate[2] / 2 + (3 - level) * crate[2];
    out.push({
      x: p.at[0] + dx * distance,
      z: p.at[1] + dz * distance,
      top: crate[1] * level,
    });
  }
  out.push({ x: p.at[0], z: p.at[1], top: DECK_TOP });
  return out;
}

function platformBoxes(p: Platform): MapBox[] {
  const crate = colliderFor("crate");
  const pillar = colliderFor("pillar");
  const [dx, dz] = sideOf(p.from);
  // Treads run across the approach: x-approach spreads them in z and back.
  const [ax, az] = [Math.abs(dz), Math.abs(dx)];
  const boxes: MapBox[] = [];

  // Deck. Its top lands on DECK_TOP exactly; the legs stop underneath it.
  boxes.push({
    p: [p.at[0], DECK_TOP - DECK_THICKNESS / 2, p.at[1]],
    s: [DECK_SIZE, DECK_THICKNESS, DECK_SIZE],
    c: WALL_COLOR,
    wall: true,
    slab: true,
  });

  // Four pillar legs, inset a leg's width from the corners.
  const inset = DECK_SIZE / 2 - pillar[0] / 2 - 0.1;
  for (const cx of [-inset, inset]) {
    for (const cz of [-inset, inset]) {
      boxes.push({
        p: [p.at[0] + cx, pillar[1] / 2, p.at[1] + cz],
        s: [...pillar] as [number, number, number],
        c: WALL_COLOR,
        family: "pillar",
      });
    }
  }

  // The stair: at each level, a stack of crates two abreast.
  for (let level = 1; level <= 3; level++) {
    const distance = DECK_SIZE / 2 + crate[2] / 2 + (3 - level) * crate[2];
    const cx = p.at[0] + dx * distance;
    const cz = p.at[1] + dz * distance;
    for (const side of [-0.5, 0.5]) {
      for (let stacked = 0; stacked < level; stacked++) {
        boxes.push({
          p: [
            cx + ax * side * crate[0],
            crate[1] * stacked + crate[1] / 2,
            cz + az * side * crate[0],
          ],
          s: [...crate] as [number, number, number],
          c: familyOf("crate").colors[(level + stacked) % 2],
          family: "crate",
        });
      }
    }
  }

  return boxes;
}

/**
 * Loose clutter, on top of the designed rows.
 *
 * The rows give a seeker somewhere to look; the clutter is what makes looking
 * cost time. It's laid down by a seeded generator rather than by hand because
 * the point is that it has no pattern to learn — but the seed is fixed, so the
 * map is still the same every round and check:map still has something definite
 * to verify.
 */
const CLUTTER_SEED = 20260729;
/**
 * Rejection sampling gets slow as the floor fills, so most attempts fail by the
 * end. 6000 is what it takes to reach the target; raising the target further
 * starts closing routes, which check:map catches.
 */
const CLUTTER_ATTEMPTS = 40000;
/**
 * 440 -> 640 with the instancing pass: repeated models now cost one draw per
 * (geometry, material) pair rather than per prop, so density is bounded by
 * routes staying open (check:map) rather than by draw calls again.
 */
const CLUTTER_TARGET = 640;

/** mulberry32 — small and deterministic. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Clutter models include things that aren't families (tanks, chimneys). */
function pickColorFor(id: string, alternate: number): number {
  return FAMILIES.find((f) => f.id === id)?.colors[alternate % 2] ?? WALL_COLOR;
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

  for (const b of BUILDINGS) {
    const size = colliderFor(b.model);
    // A quarter turn swaps which way the footprint runs; the collider has to
    // follow or the building would block metres of floor it doesn't stand on.
    const turned = Math.abs(Math.sin(b.rotY ?? 0)) > 0.5;
    const s: [number, number, number] = turned
      ? [size[2], size[1], size[0]]
      : [size[0], size[1], size[2]];
    boxes.push({
      p: [b.at[0], s[1] / 2, b.at[1]],
      s,
      c: WALL_COLOR,
      family: b.model,
      rotY: b.rotY,
    });
  }

  // Platforms before clutter, so the sampler treats a stair tread like any
  // other thing it must not fuse against.
  for (const p of PLATFORMS) boxes.push(...platformBoxes(p));

  // Clutter goes last so it can be rejected against everything already placed.
  const random = rng(CLUTTER_SEED);
  const kinds: ModelId[] = ["drum", "crate", "pallet", "tank", "chimney"];
  const limit = ARENA.size / 2 - 2;
  let placed = 0;

  for (let attempt = 0; attempt < CLUTTER_ATTEMPTS && placed < CLUTTER_TARGET; attempt++) {
    const model = kinds[Math.floor(random() * kinds.length)];
    const size = colliderFor(model);
    const x = (random() * 2 - 1) * limit;
    const z = (random() * 2 - 1) * limit;

    // The seeker starts at the origin and must not start inside a barrel.
    if (Math.hypot(x, z) < 3) continue;
    // Nor may a hider, and a spawn wants room to turn around in.
    if (SPAWN_POINTS.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 2.5)) continue;
    // The designed slots are the one thing clutter must not fill in.
    if (CLUSTERS.some((c) => { const [sx, sz] = slotOf(c); return Math.hypot(x - sx, z - sz) < 2.5; })) continue;
    // Nor the climb routes: the stair only counts as a stair if the giant can
    // walk up to its first tread, and the clear-gap test below keeps clutter a
    // body's width from the treads themselves, not from the approach to them.
    if (PLATFORMS.some((p) => climbRoute(p).some((w) => Math.hypot(x - w.x, z - w.z) < 2.8))) continue;

    // Leave the GIANT's width between this and anything already down — the
    // seeker is 0.9 in radius, so a 1.0 gap that lets a hider slip through is
    // a wall to the seeker, and at 640 pieces those walls joined up into a
    // ring that sealed the arena centre off entirely (caught by check:map's
    // seeker-reachability sweep, which is exactly the failure it exists for).
    const clear = boxes.every((b) => {
      const gapX = Math.abs(x - b.p[0]) - (size[0] + b.s[0]) / 2;
      const gapZ = Math.abs(z - b.p[2]) - (size[2] + b.s[2]) / 2;
      return Math.max(gapX, gapZ) > 1.9;
    });
    if (!clear) continue;

    boxes.push({
      p: [x, size[1] / 2, z],
      s: size,
      c: pickColorFor(model, placed),
      family: model,
      rotY: random() * Math.PI * 2,
    });
    placed++;
  }

  return boxes;
}

export const MAP_BOXES: MapBox[] = buildArena();
