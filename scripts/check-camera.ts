/**
 * Camera mode priority. All of it is a decision table, so none of it needs a
 * renderer — which is the reason cameraModeFor is a pure function at all.
 */
import { cameraModeFor, type CameraModeInput } from "../game/src/game/cameraMode";

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

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
