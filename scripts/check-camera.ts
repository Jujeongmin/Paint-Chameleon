/**
 * Camera mode priority. All of it is a decision table, so none of it needs a
 * renderer — which is the reason cameraModeFor is a pure function at all.
 */
import {
  FREE_FLY,
  cameraModeFor,
  clampFreeCamera,
  type CameraModeInput,
} from "../game/src/game/cameraMode";
import { ARENA } from "../game/src/game/arena";
import { MAP_BOXES } from "../game/src/game/map";

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

// The ceiling's justification: it clears everything standing on the map with
// a wall's worth of room to spare, so you can cross a wall and look down the
// far side of it. Measured against the map itself, not against the constant it
// was derived from — a taller structure added later fails here.
const tallest = MAP_BOXES.reduce((most, b) => Math.max(most, b.p[1] + b.s[1] / 2), 0);
check(
  "the ceiling clears the tallest thing on the map by a wall height",
  FREE_FLY.ceiling >= tallest + ARENA.wallHeight,
  `ceiling ${FREE_FLY.ceiling} vs tallest ${tallest.toFixed(1)} + ${ARENA.wallHeight}`
);

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
