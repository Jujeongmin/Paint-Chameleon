/**
 * Body profile invariants.
 *
 * Avatars are cosmetic by construction, not by promise: every profile must sit
 * inside the exact collision and camera envelope the original body defined, or
 * buying one would buy an advantage in a hide-and-seek game.
 *
 * Run: npm run check:bodies
 */

import { CAMERA, MOVE, STAND_POSE } from "../game/src/game/constants";
import { aimHandOffset } from "../game/src/game/aim";
import { poseBounds, poseSize } from "../game/src/game/poseBounds";
import {
  BODIES,
  DEFAULT_BODY_ID,
  EPS,
  FOOT_Y,
  SHOULDER_RANGE,
  TOP_Y,
  derive,
  maxHalfWidth,
  profileFor,
  validateProfile,
  type BodyProfile,
} from "../game/src/game/bodies";

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

  // maxHalfWidth is Math.max of three terms (shoulderX + arm.r, torso.r,
  // hipX + leg.r); no existing test isolates the third. hipX 0.4 (base leg.r
  // is 0.125) gives 0.4 + 0.125 = 0.525 > MOVE.playerRadius (0.45), while the
  // shoulder term (0.35 + 0.1 = 0.45) and torso term (0.26) both stay within
  // bounds — so only the hipX term can be responsible for the rejection.
  {
    const bent = bend({ hipX: 0.4 });
    check("hipX pushes maxHalfWidth past the collision radius", maxHalfWidth(bent) > MOVE.playerRadius);
    check("rejects a hip pushed wider than the collision radius", validateProfile(bent).length > 0);
  }
}

console.log("\ncamera/shoulder consistency");
{
  check(
    "SHOULDER_RANGE brackets CAMERA.shoulderHeight",
    SHOULDER_RANGE.min <= CAMERA.shoulderHeight && CAMERA.shoulderHeight <= SHOULDER_RANGE.max,
    `shoulderHeight ${CAMERA.shoulderHeight}, range ${SHOULDER_RANGE.min}..${SHOULDER_RANGE.max}`
  );
}

console.log("\npose silhouette (poseBounds mirrors Humanoid's rest layout)");
{
  // The top and bottom of the standing silhouette must agree with the values
  // bodies.ts already knows independently. If poseBounds ever drifts away from
  // Humanoid's rest layout, this anchor is what breaks first.
  for (const b of BODIES) {
    const s = poseBounds(b, STAND_POSE);
    check(`${b.id}: standing crown lands on TOP_Y (${s.max[1].toFixed(4)})`, Math.abs(s.max[1] - TOP_Y) < 1e-9);
    check(`${b.id}: standing sole lands on FOOT_Y (${s.min[1].toFixed(4)})`, Math.abs(s.min[1] - FOOT_Y) < 1e-9);
  }
  // The arms rest slightly spread, so the silhouette can only be wider than
  // maxHalfWidth, never narrower.
  for (const b of BODIES) {
    const half = poseSize(b, STAND_POSE).width / 2;
    check(
      `${b.id}: standing half-width is at least maxHalfWidth, within +0.15 (${half.toFixed(3)} vs ${maxHalfWidth(b).toFixed(3)})`,
      half >= maxHalfWidth(b) - 1e-9 && half <= maxHalfWidth(b) + 0.15
    );
  }
}

console.log("\nfirst person");
{
  /**
   * The gun has to be on screen. The camera is fov 70 vertically (App.tsx), so
   * the view reaches 35 degrees above and below its axis; at 4:3 that is 43
   * degrees to each side (atan(tan 35 * 4/3)). Windows narrower than 4:3 are
   * deliberately not covered — bean's gun leaves the frame first, and this
   * check is where that shows up if an arm ever gets shorter still.
   */
  const HALF_FOV_DOWN = 35;
  const HALF_FOV_SIDE = 43;

  for (const b of BODIES) {
    const hand = aimHandOffset(b);
    const down = (Math.atan2(CAMERA.eyeHeight - hand.y, hand.z) * 180) / Math.PI;
    // Magnitude only: the gun is on the body's right, so hand.x is negative.
    const side = (Math.atan2(Math.abs(hand.x), hand.z) * 180) / Math.PI;

    check(
      `${b.id}: the gun sits below the view axis but inside it (${down.toFixed(1)}°)`,
      down < HALF_FOV_DOWN,
      `must stay under ${HALF_FOV_DOWN}°`
    );
    check(
      `${b.id}: and inside it sideways at 4:3 (${side.toFixed(1)}°)`,
      side < HALF_FOV_SIDE,
      `must stay under ${HALF_FOV_SIDE}°`
    );

    // In first person the camera sits at eye height inside the head, which is
    // hidden. If a profile's torso reaches past that height, its top cap
    // crosses the 0.1 near plane and looking straight down slices your own
    // chest open. tank has 0.04u of room; this prints the number rather than
    // letting the fact go unrecorded.
    const torsoTop = b.torso.y + b.torso.l / 2 + b.torso.r;
    check(
      `${b.id}: the eye clears the torso (${(CAMERA.eyeHeight - torsoTop).toFixed(2)}u of room)`,
      torsoTop < CAMERA.eyeHeight,
      `torso top ${torsoTop.toFixed(2)} vs eye ${CAMERA.eyeHeight}`
    );

    // Raising the arm moves the silhouette in Z, never in local X, so the
    // envelope every other check in this file defends is untouched by aiming.
    check(
      `${b.id}: aiming does not widen the body (hand x ${hand.x.toFixed(2)})`,
      Math.abs(hand.x) <= maxHalfWidth(b) + EPS
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
