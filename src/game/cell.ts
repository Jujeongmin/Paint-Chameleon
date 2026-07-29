/**
 * The seeker's holding cell.
 *
 * The seeker used to spend the hiding phase behind an opaque overlay, frozen in
 * place — fair, but forty-five seconds of looking at a black rectangle. This is
 * a room to spend them in instead.
 *
 * It sits underground rather than in the arena so it costs no floor space and
 * no hider can find it. That is only possible because groundHeightAt takes a
 * floor height now; the implicit plane at y=0 would otherwise lift anything
 * standing here straight up to the surface.
 *
 * Sealed on all six sides. The ceiling is not about escape — you cannot walk
 * through the walls either — it is about sight: without one you look up through
 * the arena floor from below.
 */

import type { MapBox } from "./arena";
import { MOVE } from "./constants";
import { TOP_Y } from "./bodies";

/** Deep enough that nothing in the arena reaches down to it. */
export const CELL_FLOOR_Y = -8;

/** Inner side length. Room to walk and to orbit the camera round your body. */
export const CELL_INNER = 6;

/** Half-extent handed to moveXZ, which clamps to ±(worldHalfSize - radius). */
export const CELL_HALF = CELL_INNER / 2 + MOVE.playerRadius;

/** Head clearance above the floor. */
const CELL_HEIGHT = 3;

const THICKNESS = 0.5;

export const CELL_SPAWN: [number, number, number] = [0, CELL_FLOOR_Y, 0];

const CONCRETE = 0x6f7378;
const TRIM = 0x8a8f96;

function slab(
  p: [number, number, number],
  s: [number, number, number],
  c: number
): MapBox {
  return { p, s, c, wall: true };
}

/**
 * Six slabs. The walls stand ON the floor slab rather than beside it, so their
 * inner faces are exactly ±CELL_INNER/2 and CELL_HALF describes the same room
 * the collision boxes do.
 */
export const CELL_BOXES: MapBox[] = (() => {
  const half = CELL_INNER / 2;
  const outer = CELL_INNER + THICKNESS * 2;
  const midY = CELL_FLOOR_Y + CELL_HEIGHT / 2;

  return [
    // Floor and ceiling.
    slab([0, CELL_FLOOR_Y - THICKNESS / 2, 0], [outer, THICKNESS, outer], CONCRETE),
    slab([0, CELL_FLOOR_Y + CELL_HEIGHT + THICKNESS / 2, 0], [outer, THICKNESS, outer], TRIM),
    // Walls.
    slab([0, midY, -half - THICKNESS / 2], [outer, CELL_HEIGHT, THICKNESS], CONCRETE),
    slab([0, midY, half + THICKNESS / 2], [outer, CELL_HEIGHT, THICKNESS], CONCRETE),
    slab([-half - THICKNESS / 2, midY, 0], [THICKNESS, CELL_HEIGHT, outer], TRIM),
    slab([half + THICKNESS / 2, midY, 0], [THICKNESS, CELL_HEIGHT, outer], TRIM),
  ];
})();

/** Sanity: a 1.86-tall body has to fit under the ceiling. */
export const CELL_CLEARS_BODY = CELL_HEIGHT > TOP_Y;
