/**
 * Camera mode priority. All of it is a decision table, so none of it needs a
 * renderer — which is the reason cameraModeFor is a pure function at all.
 */
import {
  FREE_FLY,
  cameraBoxesFor,
  cameraModeFor,
  clampFreeCamera,
  type CameraModeInput,
} from "../game/src/game/cameraMode";
import { CAMERA_RADIUS, clearCameraDistance } from "../game/src/game/camera";
import { MAP_BOXES } from "../game/src/game/map";
import { ARENA, type MapBox } from "../game/src/game/arena";
import { CELL_BOXES } from "../game/src/game/cell";
import { CAMERA, MOVE } from "../game/src/game/constants";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const base: CameraModeInput = {
  paintMode: false,
  charLocked: false,
  isSeeker: false,
  phase: "hiding",
};

console.log("camera mode priority\n");

check("a hider in the hiding phase follows", cameraModeFor(base) === "follow");
check(
  "the seeker hunting is first person",
  cameraModeFor({ ...base, isSeeker: true, phase: "seeking" }) === "firstPerson"
);
check(
  "the seeker waiting out the hiding phase is not",
  cameraModeFor({ ...base, isSeeker: true, phase: "hiding" }) === "follow"
);
check("a pinned hider flies free", cameraModeFor({ ...base, charLocked: true }) === "freeFly");

// The exclusions the design leans on. Each of these is unreachable through the
// UI today; they are here so that a change which makes one reachable shows up
// as a failure rather than as a camera quietly doing the wrong thing.
check(
  "a seeker cannot fly, whatever charLocked says",
  cameraModeFor({ ...base, isSeeker: true, phase: "seeking", charLocked: true }) === "firstPerson"
);
check(
  "painting beats first person",
  cameraModeFor({ ...base, paintMode: true, isSeeker: true, phase: "seeking" }) === "paint"
);
check(
  "painting beats free flight",
  cameraModeFor({ ...base, paintMode: true, charLocked: true }) === "paint"
);

console.log("\nfree flight box\n");

const far = clampFreeCamera(500, 500, -500);
check(
  "flying at the sky and the far corner stops at the box",
  far[0] === FREE_FLY.half && far[1] === FREE_FLY.ceiling && far[2] === -FREE_FLY.half,
  far.map((n) => n.toFixed(1)).join(", ")
);

const under = clampFreeCamera(0, -20, 0);
check("and it never gets under the floor", under[1] === FREE_FLY.floor, `${under[1]}`);

const inside = clampFreeCamera(3, 6, -9);
check(
  "a position already inside the box is left alone",
  inside[0] === 3 && inside[1] === 6 && inside[2] === -9,
  inside.join(", ")
);

// The ceiling has two jobs and they pull against each other, so both are
// measured against the map itself rather than against the constants they were
// derived from — whichever a later change breaks, it fails here.
//
// One: stay indoors. The arena has a lid, and a camera parked in or above it
// sees the roof or the void, which is the failure the roof was added to fix.
const roof = MAP_BOXES.find((b) => b.roof);
check("the arena has a roof to stay under", !!roof);
const roofUnderside = roof ? roof.p[1] - roof.s[1] / 2 : Infinity;
check(
  "the free camera stays under the roof, with its own padding to spare",
  FREE_FLY.ceiling + CAMERA_RADIUS <= roofUnderside,
  `ceiling ${FREE_FLY.ceiling} + ${CAMERA_RADIUS} vs underside ${roofUnderside}`
);

// Two: still be high enough to be worth flying to. Every deck is somewhere a
// player can stand, so the camera has to clear the highest of them by more
// than a body — otherwise you fly up and are level with the thing you meant to
// look down on.
const decks = MAP_BOXES.filter((b) => b.slab);
check("there are decks to look down on", decks.length > 0);
const highestDeck = decks.reduce((most, b) => Math.max(most, b.p[1] + b.s[1] / 2), 0);
check(
  "and clears the highest deck by more than a standing body",
  FREE_FLY.ceiling >= highestDeck + 2,
  `ceiling ${FREE_FLY.ceiling} vs deck ${highestDeck.toFixed(2)} + 2`
);

// Nothing on the map may poke through the lid. A structure taller than the
// roof would be visible from outside it and unreachable from inside.
const tallestUnderRoof = MAP_BOXES.reduce(
  (most, b) => (b.roof ? most : Math.max(most, b.p[1] + b.s[1] / 2)),
  0
);
check(
  "nothing standing on the floor reaches the roof",
  tallestUnderRoof <= roofUnderside,
  `tallest ${tallestUnderRoof.toFixed(1)} vs underside ${roofUnderside}`
);


// --- Paint mode against a wall -------------------------------------------
//
// The bug this pins: a hider paints where they mean to hide, and that is
// against a wall. Orbiting to the far side put the wall between camera and
// pivot, and clearCameraDistance answers a blocked ray with the blocked
// distance — `paintMinDistance` reads like a floor in the signature and is not
// one. The camera ended up inside the head and that side stayed unpainted.
//
// Both halves are asserted. The second is the fix; the FIRST is the reason the
// fix has to exist, and if it ever goes green on its own the exception in
// cameraBoxesFor is no longer earning its keep and should go.

const wallInner = ARENA.size / 2 - ARENA.wallThickness;
// Standing as close to the north wall as a body can get.
const pivot = { x: 0, y: 0.95, z: wallInner - MOVE.playerRadius };
const desired = CAMERA.paintFar;

/** Worst distance the camera gets over a full turn around the body. */
function worstOrbit(boxes: MapBox[]): number {
  let worst = Infinity;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    // Same construction as the follow rig: yaw around, pitched slightly down.
    const pitch = 0.15;
    const dir = {
      x: Math.sin(a) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: Math.cos(a) * Math.cos(pitch),
    };
    worst = Math.min(
      worst,
      clearCameraDistance(pivot, dir, desired, CAMERA.paintMinDistance, boxes, 0)
    );
  }
  return worst;
}

const collided = worstOrbit(MAP_BOXES);
check(
  "colliding with the map DOES strand the camera beside a wall — the reason paint mode opts out",
  collided < CAMERA.paintMinDistance,
  `worst ${collided.toFixed(2)} < paintMinDistance ${CAMERA.paintMinDistance}`
);

const painting = worstOrbit(cameraBoxesFor(true, false));
check(
  "paint mode keeps the full distance all the way round, so every side is reachable",
  painting >= desired - 1e-6,
  `worst ${painting.toFixed(2)} vs desired ${desired}`
);

// The exception is paint mode's alone. Play and the holding cell must still
// collide, or the follow camera would sit outside the world.
check(
  "play still collides with the map",
  cameraBoxesFor(false, false) === MAP_BOXES,
  `${cameraBoxesFor(false, false).length} boxes`
);
check(
  "the holding cell still collides with its own boxes",
  cameraBoxesFor(false, true) === CELL_BOXES,
  `${cameraBoxesFor(false, true).length} boxes`
);

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
