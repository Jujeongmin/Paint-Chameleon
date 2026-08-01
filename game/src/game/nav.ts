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
 * thing, so it lives here and check:map imports it rather than keeping a
 * second copy that can drift.
 *
 * What this gives you is a route through cells a body of a given radius fits
 * in. It does NOT promise the movement code can follow it — a corridor a grid
 * route passes through can still be too tight for the integrator to steer.
 * check:map drives the real integrator along these routes for that reason, and
 * the bots simply walk them and let collision sort out the rest.
 *
 * ON SPEED. This is the only thing in the game that asks a collision question
 * tens of thousands of times in a row, and it does it mid-round: a bot re-plans
 * every time the seeker comes within thirteen metres. Measured cost of one
 * route, in the order the fixes landed:
 *
 *   138ms  asking collision per cell, scanning all 715 boxes each time
 *    17ms  ...with the spatial index in map.ts
 *   4.3ms  ...with the walkability grid below precomputed
 *          ...with the flood on typed arrays and stopping at the goal
 *
 * The first number is eight frames of the game simply stopping, four times over
 * when four bots bolt together — which is what it looked like on screen.
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

function fill(o: NavOptions): Required<NavOptions> {
  return { feetY: 0, grid: NAV_GRID, ...o };
}

// ------------------------------------------------------- walkability, cached

/**
 * "Can a body of radius R stand in this cell", one byte per cell.
 *
 * The map never changes, so this answer never changes — computing it once turns
 * every later route into array lookups. The build costs ~11ms, which is why it
 * is not left to happen lazily in the middle of a chase: `prewarmNav` runs
 * while the loading screen is up, and doing it there is most of why that screen
 * exists.
 */
interface WalkGrid {
  cells: Uint8Array;
  limit: number;
  side: number;
  grid: number;
}

const walkGrids = new WeakMap<MapBox[], Map<string, WalkGrid>>();

function cellIndex(ix: number, iz: number, g: { limit: number; side: number }): number {
  return (ix + g.limit) * g.side + (iz + g.limit);
}

function walkGridFor(o: Required<NavOptions>): WalkGrid {
  let byKey = walkGrids.get(o.boxes);
  if (!byKey) {
    byKey = new Map();
    walkGrids.set(o.boxes, byKey);
  }
  const key = `${o.radius}|${o.feetY}|${o.grid}|${o.halfSize}`;
  const cached = byKey.get(key);
  if (cached) return cached;

  const limit = Math.floor((o.halfSize - o.radius) / o.grid);
  const side = limit * 2 + 1;
  const built: WalkGrid = { cells: new Uint8Array(side * side), limit, side, grid: o.grid };
  for (let ix = -limit; ix <= limit; ix++) {
    for (let iz = -limit; iz <= limit; iz++) {
      if (!playerBlockedAt(ix * o.grid, iz * o.grid, o.feetY, o.radius, o.boxes)) {
        built.cells[cellIndex(ix, iz, built)] = 1;
      }
    }
  }

  byKey.set(key, built);
  return built;
}

/**
 * Build the walk grid ahead of time. Idempotent and cached, so calling it twice
 * is free; never calling it is what causes the stall it exists to prevent.
 */
export function prewarmNav(options: NavOptions): void {
  walkGridFor(fill(options));
}

function walkable(ix: number, iz: number, g: WalkGrid): boolean {
  if (Math.abs(ix) > g.limit || Math.abs(iz) > g.limit) return false;
  return g.cells[cellIndex(ix, iz, g)] === 1;
}

// -------------------------------------------------------------------- flood

/**
 * A completed flood, as flat arrays rather than a Map.
 *
 * The Map version cost 4.3ms per route once everything else was fast, and all
 * of it was hashing: a flood touches tens of thousands of cells and every one
 * meant a boxed number key going in and coming back out. Cell indices are
 * already dense integers, so an Int32Array indexed by cell IS the map.
 */
export interface Flood {
  /** Per cell: UNVISITED, ROOT, or the index of the cell it was reached from. */
  parent: Int32Array;
  limit: number;
  side: number;
  grid: number;
}

const UNVISITED = -2;
const ROOT = -1;

/**
 * Flood outward from `start`, stopping the moment `goal` is reached if one is
 * given.
 *
 * The early exit is not a micro-optimisation. A route to somewhere nearby stops
 * after a few hundred cells instead of filling all 88x88 metres of arena, and
 * "somewhere nearby" is what a fleeing bot asks for every single time.
 */
function flood(start: [number, number], o: Required<NavOptions>, goal?: [number, number]): Flood {
  const g = walkGridFor(o);
  const out: Flood = {
    parent: new Int32Array(g.side * g.side).fill(UNVISITED),
    limit: g.limit,
    side: g.side,
    grid: o.grid,
  };

  const sx = Math.round(start[0] / o.grid);
  const sz = Math.round(start[1] / o.grid);
  if (!walkable(sx, sz, g)) return out;

  let goalIndex = -1;
  if (goal) {
    const gx = Math.round(goal[0] / o.grid);
    const gz = Math.round(goal[1] / o.grid);
    if (Math.abs(gx) <= g.limit && Math.abs(gz) <= g.limit) goalIndex = cellIndex(gx, gz, g);
  }

  // Bounded by the cell count, so the queue is allocated once at full size
  // rather than grown.
  const queue = new Int32Array(g.side * g.side);
  let head = 0;
  let tail = 0;
  const first = cellIndex(sx, sz, g);
  queue[tail++] = first;
  out.parent[first] = ROOT;

  while (head < tail) {
    const current = queue[head++];
    if (current === goalIndex) break;
    const ix = ((current / g.side) | 0) - g.limit;
    const iz = (current % g.side) - g.limit;

    for (let d = 0; d < 4; d++) {
      const nx = ix + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const nz = iz + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (Math.abs(nx) > g.limit || Math.abs(nz) > g.limit) continue;
      const k = cellIndex(nx, nz, g);
      if (out.parent[k] !== UNVISITED || g.cells[k] !== 1) continue;
      out.parent[k] = current;
      queue[tail++] = k;
    }
  }
  return out;
}

/**
 * Every cell reachable on foot from `start`, with a parent link back toward it.
 * Nothing is reached if `start` itself is inside geometry.
 */
export function floodFrom(start: [number, number], options: NavOptions): Flood {
  return flood(start, fill(options));
}

/** Whether a flood reached this world position's cell. */
export function reached(f: Flood, at: [number, number]): boolean {
  const ix = Math.round(at[0] / f.grid);
  const iz = Math.round(at[1] / f.grid);
  if (Math.abs(ix) > f.limit || Math.abs(iz) > f.limit) return false;
  return f.parent[cellIndex(ix, iz, f)] !== UNVISITED;
}

/** Waypoints from the flood's origin to `goal`, or null if it never got there. */
export function routeTo(f: Flood, goal: [number, number]): [number, number][] | null {
  const gx = Math.round(goal[0] / f.grid);
  const gz = Math.round(goal[1] / f.grid);
  if (Math.abs(gx) > f.limit || Math.abs(gz) > f.limit) return null;

  let k = cellIndex(gx, gz, f);
  if (f.parent[k] === UNVISITED) return null;

  const out: [number, number][] = [];
  while (k !== ROOT) {
    out.push([(((k / f.side) | 0) - f.limit) * f.grid, ((k % f.side) - f.limit) * f.grid]);
    k = f.parent[k];
  }
  return out.reverse();
}

/** Flood and extract in one call, stopping as soon as the goal is in hand. */
export function findRoute(
  from: [number, number],
  to: [number, number],
  options: NavOptions
): [number, number][] | null {
  const o = fill(options);
  return routeTo(flood(from, o, to), to);
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
