/**
 * Procedural arena. Everything is axis-aligned boxes, so the same data drives
 * rendering, collision and the server's spawn placement — and the hub reuses
 * the same collision helpers with its own box list.
 *
 * buildMap() is deterministic and is duplicated verbatim in server/src/rules.ts.
 * Change the generator here and you must change it there, or players will walk
 * around one arena while the server spawns them into another.
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

// ---------------------------------------------------------------- collision

const STEP_HEIGHT = 1.15;

function overlapsXZ(b: MapBox, x: number, z: number, r: number): boolean {
  return (
    Math.abs(x - b.p[0]) < b.s[0] / 2 + r && Math.abs(z - b.p[2]) < b.s[2] / 2 + r
  );
}

/** True if a box is a wall at this standing height — steppable tops and overhead-clear boxes don't count. */
function isWallAt(b: MapBox, feetY: number): boolean {
  const top = b.p[1] + b.s[1] / 2;
  const bottom = b.p[1] - b.s[1] / 2;
  if (top <= feetY + STEP_HEIGHT) return false;
  if (bottom > feetY + 1.8) return false;
  return true;
}

/** Highest surface the player can stand on at (x,z), given their current feet height. */
export function groundHeightAt(x: number, z: number, feetY: number, boxes = MAP_BOXES): number {
  let best = 0;
  for (const b of boxes) {
    if (!overlapsXZ(b, x, z, 0)) continue;
    const top = b.p[1] + b.s[1] / 2;
    if (top <= feetY + STEP_HEIGHT && top > best) best = top;
  }
  return best;
}

/**
 * True if a box blocks the player standing at (x,z) with their feet at feetY.
 * Exported so tests can ask the real question instead of reimplementing the
 * rules — a copy silently forgets things like the overhead clearance.
 */
export function playerBlockedAt(
  x: number,
  z: number,
  feetY: number,
  r: number,
  boxes: MapBox[] = MAP_BOXES
): boolean {
  for (const b of boxes) {
    if (!overlapsXZ(b, x, z, r)) continue;
    if (!isWallAt(b, feetY)) continue;
    return true;
  }
  return false;
}

/**
 * Horizontal move only — height is left alone so the caller can run its own
 * gravity. Axis-separated so sliding along a wall keeps the tangential speed.
 */
export function moveXZ(
  from: [number, number, number],
  dx: number,
  dz: number,
  radius: number,
  boxes = MAP_BOXES,
  /** Half-extent of the enclosing space. The hub is smaller than the arena. */
  worldHalfSize = ARENA.size / 2
): [number, number, number] {
  let [x, y, z] = from;

  const xBlocked = dx !== 0 && playerBlockedAt(x + dx, z, y, radius, boxes);
  const zBlocked = dz !== 0 && playerBlockedAt(x, z + dz, y, radius, boxes);

  if (!xBlocked) x += dx;
  if (!zBlocked) z += dz;

  // A flat wall never trips this: the axis with no input is never "blocked"
  // (moving it by zero can't newly collide), so only a concave corner — two
  // separate walls/props pinning a diagonal approach — gets both at once.
  // A tangent-to-the-heading nudge isn't reliable here: at a right-angle
  // inside corner, rotating the heading 90° just trades "into wall A" for
  // "into wall B" (each wall runs the full length of the pocket, not just
  // the corner point), and picking whichever opens first can flip-flop
  // frame to frame, oscillating in place instead of making progress.
  //
  // Push out by the combined penetration depth against every nearby wall
  // instead — standard circle-vs-box minimum-translation-vector resolution.
  // It only depends on the boxes' geometry at the point the player tried to
  // reach, not on which way they're facing, so repeating it every frame
  // converges instead of bouncing between two points, and along an
  // off-centre approach (the common case — a perfectly symmetric 45° hit is
  // the rare exception) it reads as sliding along whichever wall is closer.
  if (xBlocked && zBlocked) {
    const tx = x + dx;
    const tz = z + dz;
    let pushX = 0;
    let pushZ = 0;
    for (const b of boxes) {
      if (!isWallAt(b, y)) continue;
      const halfX = b.s[0] / 2;
      const halfZ = b.s[2] / 2;
      const closestX = Math.max(b.p[0] - halfX, Math.min(tx, b.p[0] + halfX));
      const closestZ = Math.max(b.p[2] - halfZ, Math.min(tz, b.p[2] + halfZ));
      const ox = tx - closestX;
      const oz = tz - closestZ;
      const dist = Math.hypot(ox, oz);
      if (dist >= radius) continue; // this box doesn't actually reach the attempted spot
      if (dist < 1e-6) {
        // Center lands exactly on the box's surface — push along whichever
        // axis has the shallower penetration rather than dividing by zero.
        const penX = halfX + radius - Math.abs(tx - b.p[0]);
        const penZ = halfZ + radius - Math.abs(tz - b.p[2]);
        if (penX < penZ) pushX += Math.sign(tx - b.p[0] || 1) * penX;
        else pushZ += Math.sign(tz - b.p[2] || 1) * penZ;
      } else {
        const depth = radius - dist;
        pushX += (ox / dist) * depth;
        pushZ += (oz / dist) * depth;
      }
    }
    if (pushX !== 0 || pushZ !== 0) {
      const nx = x + pushX;
      const nz = z + pushZ;
      if (!playerBlockedAt(nx, nz, y, radius, boxes)) {
        x = nx;
        z = nz;
      }
    }
  }

  const limit = worldHalfSize - radius;
  x = Math.max(-limit, Math.min(limit, x));
  z = Math.max(-limit, Math.min(limit, z));

  return [x, y, z];
}

/**
 * Move and snap to the surface underfoot. Used by anything that doesn't jump
 * (the offline bots); the local player runs moveXZ plus its own gravity.
 */
export function resolveMove(
  from: [number, number, number],
  dx: number,
  dz: number,
  radius: number,
  boxes = MAP_BOXES
): [number, number, number] {
  const [x, y, z] = moveXZ(from, dx, dz, radius, boxes);
  return [x, groundHeightAt(x, z, y, boxes), z];
}

/** Spawn point clear of geometry. Mirrors randomSpawn() in server/src/rules.ts. */
export function randomSpawn(boxes = MAP_BOXES): [number, number, number] {
  const limit = ARENA.size / 2 - 2.5;
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() * 2 - 1) * limit;
    const z = (Math.random() * 2 - 1) * limit;
    const clear = !boxes.some(
      (b) => Math.abs(x - b.p[0]) < b.s[0] / 2 + 0.8 && Math.abs(z - b.p[2]) < b.s[2] / 2 + 0.8
    );
    if (clear) return [x, 0, z];
  }
  return [0, 0, 0];
}
