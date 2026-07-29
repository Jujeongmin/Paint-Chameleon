/**
 * Holding cell invariants.
 *
 * The cell is the one place in this game where the floor is not at y=0, and
 * nothing else would notice if that broke — the seeker would simply be standing
 * on the surface, invisible to every other check. So it is asserted here.
 *
 * Run: npm run check:cell
 */

import {
  CELL_BOXES,
  CELL_CLEARS_BODY,
  CELL_CLEARS_JUMP,
  CELL_FLOOR_Y,
  CELL_INNER,
  CELL_SPAWN,
} from "../src/game/cell";
import { MAP_BOXES } from "../src/game/arena";
import { groundHeightAt, playerBlockedAt } from "../src/game/map";
import { createMotionState, stepMotion } from "../src/game/movement";
import { MOVE } from "../src/game/constants";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nthe cell is somewhere you can stand");

check("a standing body clears the ceiling", CELL_CLEARS_BODY);
// There's no ceiling collision in this engine — groundHeightAt only treats a
// box top as something to land on, never something to bump against — so a
// jumping head is stopped by nothing but the room being tall enough on its
// own. This is what actually bounds CELL_HEIGHT; the standing check above is
// the easier, non-binding case.
check("a jumping body clears the ceiling", CELL_CLEARS_JUMP);
check(
  `the spawn rests on the cell floor (${groundHeightAt(
    CELL_SPAWN[0],
    CELL_SPAWN[2],
    CELL_FLOOR_Y,
    CELL_BOXES,
    CELL_FLOOR_Y
  )})`,
  groundHeightAt(CELL_SPAWN[0], CELL_SPAWN[2], CELL_FLOOR_Y, CELL_BOXES, CELL_FLOOR_Y) ===
    CELL_FLOOR_Y
);
check(
  "the spawn is not inside a wall",
  !playerBlockedAt(CELL_SPAWN[0], CELL_SPAWN[2], CELL_FLOOR_Y, MOVE.playerRadius, CELL_BOXES)
);

console.log("\nthe cell is sealed");
{
  // Walk hard at all four walls with the real integrator. Escaping is not a
  // cosmetic failure: the seeker would drop through the world.
  //
  // worldHalfSize is NOT CELL_HALF here. CELL_HALF is CELL_INNER/2 + radius,
  // and moveXZ clamps the centre to worldHalfSize - radius — so passing
  // CELL_HALF makes the clamp land on exactly CELL_INNER/2 regardless of
  // what CELL_BOXES contains, and the walk would "pass" even with the walls
  // deleted. A worldHalfSize far outside the room removes that clamp as a
  // factor, so the wall slabs are the only thing that can stop the body, and
  // containment is still checked against the walls' real inner faces.
  const dt = 1 / 60;
  const FAR_OUTSIDE = CELL_INNER * 10;
  for (const [name, yaw] of [
    ["+z", 0],
    ["-z", Math.PI],
    ["+x", Math.PI / 2],
    ["-x", -Math.PI / 2],
  ] as [string, number][]) {
    const state = createMotionState([...CELL_SPAWN] as [number, number, number]);
    for (let i = 0; i < 300; i++) {
      stepMotion(state, { forward: 1, strafe: 0, jump: true }, yaw, {
        boxes: CELL_BOXES,
        dt,
        now: i * dt * 1000,
        speed: MOVE.seekerSpeed,
        radius: MOVE.playerRadius,
        worldHalfSize: FAR_OUTSIDE,
        floorY: CELL_FLOOR_Y,
      });
    }
    const inside =
      Math.abs(state.pos[0]) <= CELL_INNER / 2 &&
      Math.abs(state.pos[2]) <= CELL_INNER / 2 &&
      state.pos[1] >= CELL_FLOOR_Y - 1e-6;
    check(
      `five seconds of walking and jumping into the ${name} wall stays inside ` +
        `(${state.pos.map((v) => v.toFixed(2)).join(", ")})`,
      inside
    );
  }
}

console.log("\nthe cell cannot collide with the arena");
{
  // They share a coordinate space; only the height keeps them apart.
  const cellTop = Math.max(...CELL_BOXES.map((b) => b.p[1] + b.s[1] / 2));
  const arenaBottom = Math.min(...MAP_BOXES.map((b) => b.p[1] - b.s[1] / 2));
  check(
    `the cell's ceiling (${cellTop.toFixed(2)}) is below the arena (${arenaBottom.toFixed(2)})`,
    cellTop < arenaBottom
  );
}

console.log("\nthe seeker has somewhere to land");
{
  // hiding -> seeking teleports the seeker to the arena centre.
  check(
    "[0,0,0] is standable in the arena",
    !playerBlockedAt(0, 0, 0, MOVE.playerRadius, MAP_BOXES) &&
      groundHeightAt(0, 0, 0, MAP_BOXES) === 0
  );
}

if (failures === 0) {
  console.log("\n✅ the holding cell holds\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
