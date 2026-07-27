/**
 * Body profile invariants.
 *
 * Avatars are cosmetic by construction, not by promise: every profile must sit
 * inside the exact collision and camera envelope the original body defined, or
 * buying one would buy an advantage in a hide-and-seek game.
 *
 * Run: npm run check:bodies
 */

import { MOVE } from "../src/game/constants";
import {
  BODIES,
  DEFAULT_BODY_ID,
  EPS,
  FOOT_Y,
  TOP_Y,
  derive,
  profileFor,
  validateProfile,
  type BodyProfile,
} from "../src/game/bodies";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\ncatalog");
{
  check("catalog is not empty", BODIES.length > 0);

  const ids = BODIES.map((b) => b.id);
  check("ids are unique", new Set(ids).size === ids.length, ids.join(", "));

  const def = BODIES.find((b) => b.id === DEFAULT_BODY_ID);
  check("the default profile exists", !!def, `looking for ${DEFAULT_BODY_ID}`);
  check("the default profile is free", def?.price === 0);
  check(
    "every other profile costs something",
    BODIES.every((b) => b.id === DEFAULT_BODY_ID || b.price > 0)
  );
  check("every profile has a display name", BODIES.every((b) => b.name.trim().length > 0));
}

console.log("\ninvariants");
for (const b of BODIES) {
  const problems = validateProfile(b);
  check(`${b.id} satisfies every invariant`, problems.length === 0, problems.join("; "));
}

console.log("\nderived values");
for (const b of BODIES) {
  const d = derive(b);
  check(
    `${b.id} crown lands exactly on TOP_Y`,
    Math.abs(d.headY + b.head.r - TOP_Y) < EPS,
    `got ${d.headY + b.head.r}`
  );
  check(
    `${b.id} feet land exactly on FOOT_Y`,
    Math.abs(d.hipY - 2 * d.legHalf - FOOT_Y) < EPS,
    `got ${d.hipY - 2 * d.legHalf}`
  );
}

console.log("\nclassic is a pixel-for-pixel match for the pre-refactor body");
{
  // These four numbers were hardcoded in Humanoid.tsx before the refactor
  // (1.52 head, 0.70 hip, ARM_HALF 0.27, LEG_HALF 0.285). If the derivation
  // drifts, every existing player silently changes shape.
  const d = derive(profileFor("classic"));
  check("head sits at 1.52", Math.abs(d.headY - 1.52) < EPS, `got ${d.headY}`);
  check("hip sits at 0.70", Math.abs(d.hipY - 0.7) < EPS, `got ${d.hipY}`);
  check("arm half-length is 0.27", Math.abs(d.armHalf - 0.27) < EPS, `got ${d.armHalf}`);
  check("leg half-length is 0.285", Math.abs(d.legHalf - 0.285) < EPS, `got ${d.legHalf}`);
}

console.log("\nunknown ids fall back rather than throwing");
{
  // This id arrives over the network from another client, so it is untrusted.
  check("an unknown id resolves to the default", profileFor("../../etc/passwd").id === DEFAULT_BODY_ID);
  check("undefined resolves to the default", profileFor(undefined).id === DEFAULT_BODY_ID);
  check("an empty string resolves to the default", profileFor("").id === DEFAULT_BODY_ID);
}

console.log("\nthe validator actually rejects bad profiles");
{
  const base = profileFor("classic");
  const bend = (patch: Partial<BodyProfile>): BodyProfile => ({ ...base, ...patch });

  check(
    "rejects a body wider than the collision radius",
    validateProfile(bend({ shoulderX: MOVE.playerRadius })).length > 0
  );
  check(
    "rejects a torso wider than the collision radius",
    validateProfile(bend({ torso: { ...base.torso, r: MOVE.playerRadius + 0.1 } })).length > 0
  );
  check("rejects shoulders too low for the camera pivot", validateProfile(bend({ shoulderY: 0.9 })).length > 0);
  // shoulderY 1.405 exceeds the range max (1.4) but stays below the torso top
  // (1.41), so only the shoulder-range rule can reject it — otherwise the test
  // would pass even if the range check were deleted or inverted.
  check("rejects shoulders too high for the camera pivot", validateProfile(bend({ shoulderY: 1.405 })).length > 0);
  // shoulderY 1.35 is comfortably inside the camera-pivot range, so this
  // profile can only be rejected by the torso containment rule — otherwise the
  // test would pass for the wrong reason and the rule could rot undetected.
  check(
    "rejects a shoulder pivot floating outside the torso",
    validateProfile(bend({ shoulderY: 1.35, torso: { r: 0.1, l: 0.1, y: 0.6 } })).length > 0
  );
  // leg.l 0.01 + leg.r 0.05 gives legHalf 0.055, so hipY = 0.13 + 2*0.055 = 0.24,
  // well below the torso bottom (0.55), so only the hip-containment rule can
  // reject it — otherwise the test would pass even if the hip check were
  // deleted or inverted.
  {
    const problems = validateProfile(bend({ leg: { r: 0.05, l: 0.01 } }));
    check(
      "rejects a hip pivot hanging below the torso",
      problems.length > 0 && problems.some((p) => p.includes("hip")),
      problems.join("; ")
    );
  }
}

if (failures === 0) {
  console.log(`\n✅ ${BODIES.length} body profiles are cosmetic-only\n`);
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
