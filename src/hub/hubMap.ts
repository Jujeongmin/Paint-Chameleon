/**
 * The social hub: a small plaza players spawn into, with portals that start a
 * match. Geometry reuses the match's MapBox format so collision, gravity and the
 * follow camera all work here without a second implementation.
 */

import type { MapBox } from "../game/map";
import { BODIES } from "../game/bodies";

export const HUB = {
  size: 34,
  wallHeight: 6,
  wallThickness: 1,
  floorColor: 0xc9c7cd,
  carpetColor: 0x8e2233,
  wallColor: 0xb0aca2,
  /** Where a player appears on entering the hub. */
  spawn: [0, 0, 10] as [number, number, number],
};

export interface Portal {
  id: string;
  label: string;
  sub: string;
  /** Centre of the archway on the floor. */
  x: number;
  z: number;
  color: number;
  /** Walk inside this radius to start matchmaking. */
  triggerRadius: number;
  /** Null until the mode exists — renders as a locked arch. */
  available: boolean;
}

export const PORTALS: Portal[] = [
  {
    id: "warehouse",
    label: "HIDE AND PAINT",
    sub: "WAREHOUSE",
    x: 0,
    z: -11,
    color: 0xe0a13a,
    triggerRadius: 2.2,
    available: true,
  },
  {
    id: "soon-a",
    label: "COMING SOON",
    sub: "",
    x: -9.5,
    z: -10,
    color: 0x6b6f7a,
    triggerRadius: 2.0,
    available: false,
  },
  {
    id: "soon-b",
    label: "COMING SOON",
    sub: "",
    x: 9.5,
    z: -10,
    color: 0x6b6f7a,
    triggerRadius: 2.0,
    available: false,
  },
];

/**
 * The avatar shop. Sits beside the carpet between the spawn point and the
 * portals, so it's passed on the way to a match rather than hunted for.
 */
export const SHOP = {
  x: -9.5,
  z: 4,
  color: 0x2f6fae,
};

export const STAND = {
  /** Distance between adjacent plinth centres along x. */
  spacing: 2.2,
  /** Walk inside this of a stand's trigger centre to be able to buy/equip it. */
  triggerRadius: 1.0,
  /** How far in front of the plinth (toward spawn, +z) you stand. */
  stepZ: 1.5,
};

export interface Stand {
  /** Body profile id; see `bodies.ts`. */
  id: string;
  name: string;
  /** 0 for the profile everyone already owns. */
  price: number;
  /** Plinth centre. */
  x: number;
  z: number;
  /** Trigger centre — where the player actually stands. */
  tx: number;
  tz: number;
}

/**
 * One stand per body, `classic` included: with the old modal panel gone, its
 * stand is the only way back to the default body after buying another.
 *
 * Derived from BODIES rather than listed, so a fifth profile widens the row
 * automatically — check:hub is what catches the row growing into a prop.
 */
export const STANDS: Stand[] = BODIES.map((b, i) => {
  const x = SHOP.x + (i - (BODIES.length - 1) / 2) * STAND.spacing;
  return { id: b.id, name: b.name, price: b.price, x, z: SHOP.z, tx: x, tz: SHOP.z + STAND.stepZ };
});

/**
 * Stand the player is close enough to interact with, if any.
 *
 * Nearest-first rather than first-match (how `portalAt` works): the triggers
 * are laid out not to overlap, but if a future profile narrows the row the
 * nearest stand is still the one the player means.
 */
export function standAt(x: number, z: number): Stand | null {
  let best: Stand | null = null;
  let bestDist = STAND.triggerRadius;
  for (const s of STANDS) {
    const d = Math.hypot(x - s.tx, z - s.tz);
    if (d <= bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * The all-time leaderboard, as a monument rather than a HUD panel.
 *
 * Mirrors the shop across the carpet — same z, same backdrop depth, same
 * height — so the two read as a matched pair of things you walk up to.
 */
export const LEADERBOARD = {
  x: 9.5,
  z: 4,
  width: 5.0,
  height: 3.2,
  /** Half-thickness of the board; the face you read sits just in front of it. */
  half: 0.2,
  color: 0xb98a2e,
};

/** World z of the readable face — the board's front surface, plus a hair. */
export const LEADERBOARD_FACE_Z = LEADERBOARD.z - 1.0 + LEADERBOARD.half + 0.02;

/** Pillars and lintel for one archway. The opening itself stays walkable. */
function archBoxes(p: Portal): MapBox[] {
  const halfWidth = 2.1;
  const pillar = 0.6;
  const height = 4.4;

  return [
    { p: [p.x - halfWidth, height / 2, p.z], s: [pillar, height, pillar], c: p.color },
    { p: [p.x + halfWidth, height / 2, p.z], s: [pillar, height, pillar], c: p.color },
    {
      p: [p.x, height + 0.35, p.z],
      s: [halfWidth * 2 + pillar, 0.7, pillar],
      c: p.color,
    },
  ];
}

function buildHub(): MapBox[] {
  const boxes: MapBox[] = [];
  const half = HUB.size / 2;
  const t = HUB.wallThickness;
  const wy = HUB.wallHeight / 2;

  // Perimeter.
  boxes.push({ p: [0, wy, -half], s: [HUB.size + t * 2, HUB.wallHeight, t], c: HUB.wallColor });
  boxes.push({ p: [0, wy, half], s: [HUB.size + t * 2, HUB.wallHeight, t], c: HUB.wallColor });
  boxes.push({ p: [-half, wy, 0], s: [t, HUB.wallHeight, HUB.size + t * 2], c: HUB.wallColor });
  boxes.push({ p: [half, wy, 0], s: [t, HUB.wallHeight, HUB.size + t * 2], c: HUB.wallColor });

  for (const portal of PORTALS) boxes.push(...archBoxes(portal));

  // A few low blocks to break up the space and give the camera something to
  // collide with — also handy for testing that the hub uses the same physics.
  // The [-12, 6] and [12, 6] blocks used to sit here. The left one covered
  // the leftmost stand trigger at (-12.8, 5.5) outright; the right one stood
  // in front of the leaderboard board. Both sides are occupied by something
  // you walk up to now, so the pair went rather than just the one that broke.
  const props: [number, number, number, number, number][] = [
    [-6, 13, 1.2, 0.7, 0x6fbf5c],
    [6, 13, 1.2, 0.7, 0x9179c4],
    [0, 2, 2.6, 0.35, 0xd4a53f],
  ];
  for (const [x, z, size, h, c] of props) {
    boxes.push({ p: [x, h / 2, z], s: [size, h, size], c });
  }

  // Shop backdrop — one wall behind the row of plinths. Wide enough to span
  // every plinth (outermost edges at ±13.42/-5.58 from the row) and set back
  // far enough that its collision range (z 2.35..3.65 once the player radius
  // is added) never reaches the stand triggers at z 5.5.
  const backdropWidth = (BODIES.length - 1) * STAND.spacing + 1.6;
  boxes.push({ p: [SHOP.x, 1.6, SHOP.z - 1.0], s: [backdropWidth, 3.2, 0.4], c: SHOP.color });

  // Leaderboard monument: the board itself, on a base slab that gives it a
  // footprint you stop at rather than walk through.
  const lb = LEADERBOARD;
  boxes.push({
    p: [lb.x, lb.height / 2, lb.z - 1.0],
    s: [lb.width, lb.height, lb.half * 2],
    c: lb.color,
  });
  boxes.push({ p: [lb.x, 0.2, lb.z - 0.6], s: [lb.width + 0.6, 0.4, 1.6], c: lb.color });

  return boxes;
}

export const HUB_BOXES: MapBox[] = buildHub();

/** Portal the player is currently standing in, if any. */
export function portalAt(x: number, z: number): Portal | null {
  for (const p of PORTALS) {
    if (Math.hypot(x - p.x, z - p.z) <= p.triggerRadius) return p;
  }
  return null;
}
