/**
 * Grid navigation over the arena's collision boxes.
 *
 * Pure, three.js-free and renderer-free, for the same reason everything else
 * load-bearing in this project is: it has to be assertable by a check script.
 *
 * A greedy heading is not enough here and never was. A row of props IS a wall,
 * so a walker steering straight at its target pins itself against the first
 * one it meets and never recovers — check:map learned that the hard way and
 * has flood-filled a route first ever since. The bots need exactly the same
 * thing, so it lives here now and check:map imports it rather than keeping a
 * second copy that can drift.
 *
 * What this gives you is a route through cells a body of a given radius fits
 * in. It does NOT promise the movement code can follow it — a corridor a grid
 * route passes through can still be too tight for the integrator to steer.
 * check:map drives the real integrator along these routes for that reason, and
 * the bots simply walk them and let collision sort out the rest.
 */

import { playerBlockedAt, type MapBox } from "./map";

/** Cell size. Half a metre is finer than the player's 0.9 diameter. */
export const NAV_GRID = 0.5;

export interface NavOptions {
  boxes: MapBox[];
  /** Body radius the route has to fit. */
  radius: number;
  /** Half-extent of the world; cells outside are not walkable. */
  halfSize: number;
  /** Feet height the collision test is asked about. */
  feetY?: number;
  grid?: number;
}

/**
 * Cells are keyed as one integer so the visited set can be a plain Map. The
 * arena is 88u across at half-metre cells, so indices stay well inside ±500 and
 * this stays collision-free.
 */
function cellKey(ix: number, iz: number): number {
  return (ix + 500) * 1000 + (iz + 500);
}

function keyToCell(k: number, grid: number): [number, number] {
  return [(Math.floor(k / 1000) - 500) * grid, ((k % 1000) - 500) * grid];
}

function walkable(ix: number, iz: number, o: Required<NavOptions>): boolean {
  const limit = Math.floor((o.halfSize - o.radius) / o.grid);
  if (Math.abs(ix) > limit || Math.abs(iz) > limit) return false;
  return !playerBlockedAt(ix * o.grid, iz * o.grid, o.feetY, o.radius, o.boxes);
}

function fill(o: NavOptions): Required<NavOptions> {
  return { feetY: 0, grid: NAV_GRID, ...o };
}

/**
 * Every cell reachable on foot from `start`, with a parent link back toward it.
 * Empty if `start` itself is inside geometry.
 */
export function floodFrom(start: [number, number], options: NavOptions): Map<number, number> {
  const o = fill(options);
  const sx = Math.round(start[0] / o.grid);
  const sz = Math.round(start[1] / o.grid);
  const parent = new Map<number, number>();
  if (!walkable(sx, sz, o)) return parent;

  const queue: [number, number][] = [[sx, sz]];
  parent.set(cellKey(sx, sz), -1);

  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      const k = cellKey(nx, nz);
      if (parent.has(k) || !walkable(nx, nz, o)) continue;
      parent.set(k, cellKey(x, z));
      queue.push([nx, nz]);
    }
  }
  return parent;
}

/** Whether a flood reached this world position's cell. */
export function reached(
  parent: Map<number, number>,
  at: [number, number],
  grid = NAV_GRID
): boolean {
  return parent.has(cellKey(Math.round(at[0] / grid), Math.round(at[1] / grid)));
}

/** Waypoints from the flood's origin to `goal`, or null if it never got there. */
export function routeTo(
  parent: Map<number, number>,
  goal: [number, number],
  grid = NAV_GRID
): [number, number][] | null {
  let k = cellKey(Math.round(goal[0] / grid), Math.round(goal[1] / grid));
  if (!parent.has(k)) return null;

  const out: [number, number][] = [];
  while (k !== -1) {
    out.push(keyToCell(k, grid));
    k = parent.get(k)!;
  }
  return out.reverse();
}

/** Flood and extract in one call, for callers that only want the one route. */
export function findRoute(
  from: [number, number],
  to: [number, number],
  options: NavOptions
): [number, number][] | null {
  const o = fill(options);
  return routeTo(floodFrom(from, o), to, o.grid);
}

/**
 * Drop waypoints that lie on the straight line between their neighbours.
 *
 * A raw flood-fill route is one waypoint every half metre, all of them on grid
 * axes, and walking it literally makes a body stagger from cell to cell in
 * right angles. Keeping only the corners lets the walker cut diagonally between
 * them, which both looks like walking and is shorter. Collision is what stops
 * the shortcut going through anything — the corners are still route cells, so
 * the line between two of them is at worst as tight as the corridor was.
 */
export function simplifyRoute(route: [number, number][]): [number, number][] {
  if (route.length <= 2) return [...route];
  const out: [number, number][] = [route[0]];
  for (let i = 1; i < route.length - 1; i++) {
    const [px, pz] = route[i - 1];
    const [cx, cz] = route[i];
    const [nx, nz] = route[i + 1];
    // Cross product of the two segments; zero means they are the same heading.
    if ((cx - px) * (nz - cz) - (cz - pz) * (nx - cx) !== 0) out.push(route[i]);
  }
  out.push(route[route.length - 1]);
  return out;
}
