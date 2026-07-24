/**
 * The social hub: a small plaza players spawn into, with portals that start a
 * match. Geometry reuses the match's MapBox format so collision, gravity and the
 * follow camera all work here without a second implementation.
 */

import type { MapBox } from "../game/map";

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
  const props: [number, number, number, number, number][] = [
    [-12, 6, 1.6, 0.9, 0xe4584f],
    [12, 6, 1.6, 0.9, 0x49b3ad],
    [-6, 13, 1.2, 0.7, 0x6fbf5c],
    [6, 13, 1.2, 0.7, 0x9179c4],
    [0, 2, 2.6, 0.35, 0xd4a53f],
  ];
  for (const [x, z, size, h, c] of props) {
    boxes.push({ p: [x, h / 2, z], s: [size, h, size], c });
  }

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
