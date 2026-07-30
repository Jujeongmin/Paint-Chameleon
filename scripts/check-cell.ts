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
  CELL_FLOOR_Y,
  CELL_INNER,
  CELL_SPAWN,
  HUNT_START,
} from "../src/game/cell";
import { MAP_BOXES, ARENA } from "../src/game/arena";
import { groundHeightAt, playerBlockedAt } from "../src/game/map";
import { createMotionState, stepMotion } from "../src/game/movement";
import { CAMERA, MOVE } from "../src/game/constants";
import { clearCameraDistance } from "../src/game/camera";
import { TOP_Y } from "../src/game/bodies";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nthe cell is somewhere you can stand");

// A formula reduced to CELL_HEIGHT > TOP_Y can't fail for any value of the
// tuning constants, and says nothing about CELL_BOXES, which is where the
// ceiling actually is. So simulate a real jump from the spawn instead and
// measure the peak head height against the ceiling slab's real lowest face.
{
  // There's no ceiling collision in this engine — groundHeightAt only treats
  // a box top as something to land on, never something to bump against — so
  // a jumping head is stopped by nothing but the room being tall enough on
  // its own.
  const dt = 1 / 60;
  const state = createMotionState([...CELL_SPAWN] as [number, number, number]);

  // The ceiling's lowest face, found geometrically rather than by trusting
  // array order: the only boxes that horizontally cover the spawn column and
  // sit above it are the floor and the ceiling, and the floor is below spawn
  // height. This still catches a ceiling slab hung from the wrong face,
  // wherever it lands in CELL_BOXES.
  const overCenter = CELL_BOXES.filter(
    (b) =>
      Math.abs(CELL_SPAWN[0] - b.p[0]) < b.s[0] / 2 &&
      Math.abs(CELL_SPAWN[2] - b.p[2]) < b.s[2] / 2 &&
      b.p[1] > CELL_SPAWN[1]
  );
  const ceilingBottom = Math.min(...overCenter.map((b) => b.p[1] - b.s[1] / 2));

  let peakHead = -Infinity;
  let everBlocked = false;
  // stepMotion only launches on the rising edge of `jump`; holding it true
  // the whole time still gives exactly one jump, which is all this needs.
  for (let i = 0; i < 120; i++) {
    stepMotion(state, { forward: 0, strafe: 0, jump: true }, 0, {
      boxes: CELL_BOXES,
      dt,
      now: i * dt * 1000,
      speed: MOVE.seekerSpeed,
      radius: MOVE.playerRadius,
      floorY: CELL_FLOOR_Y,
    });
    peakHead = Math.max(peakHead, state.pos[1] + TOP_Y);
    if (playerBlockedAt(state.pos[0], state.pos[2], state.pos[1], MOVE.playerRadius, CELL_BOXES)) {
      everBlocked = true;
    }
  }

  check(
    `a jump's peak head height (${peakHead.toFixed(2)}) stays under the ceiling (${ceilingBottom.toFixed(2)})`,
    peakHead < ceilingBottom
  );
  check("playerBlockedAt never trips during the jump", !everBlocked);
}
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
  // hiding -> seeking teleports the seeker to HUNT_START, the arena centre.
  // groundHeightAt(...) === 0 would only fail for a box whose top lands in
  // (0, 0.45] at the origin — steppable and harmless — so it asserts the
  // floorY default rather than anything about the arena. What actually
  // matters: the destination sits inside the walkable bounds and isn't
  // inside a partition.
  const half = ARENA.size / 2;
  const inBounds =
    Math.abs(HUNT_START[0]) < half - MOVE.playerRadius &&
    Math.abs(HUNT_START[2]) < half - MOVE.playerRadius;
  check(
    `HUNT_START [${HUNT_START}] is within the arena's walkable bounds`,
    inBounds
  );
  check(
    "HUNT_START is not inside a partition",
    !playerBlockedAt(HUNT_START[0], HUNT_START[2], HUNT_START[1], MOVE.playerRadius, MAP_BOXES)
  );
}

console.log("\nthe cell has room to see your own body");
{
  // Without a floorY on the camera's own collision, the pivot sits deep
  // underground at the cell's real height, cameraBlockedAt trips on the
  // floor check on the very first sample, and clearCameraDistance collapses
  // to 0 — the camera lands inside the player's head and the body never
  // renders (bodyFadeFor(0, ...) is 0). Compute the pivot exactly the way
  // updateFollowCamera does: the camera starts fully third person
  // (distance >= fadeStart), so closeness is 0 and the pivot is
  // shoulderHeight.
  const target = { x: CELL_SPAWN[0], y: CELL_SPAWN[1] + CAMERA.shoulderHeight, z: CELL_SPAWN[2] };
  const dir = { x: 0, y: 0, z: -1 };
  const allowed = clearCameraDistance(
    target,
    dir,
    CAMERA.playDistance,
    CAMERA.minDistance,
    CELL_BOXES,
    CELL_FLOOR_Y
  );
  check(
    `the camera clears fadeStart from the cell pivot (${allowed.toFixed(2)} > ${CAMERA.fadeStart})`,
    allowed > CAMERA.fadeStart
  );
}

if (failures === 0) {
  console.log("\n✅ the holding cell holds\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
