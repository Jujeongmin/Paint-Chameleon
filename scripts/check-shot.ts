/**
 * The seeker's shot decision.
 *
 * This is the only coverage the shot will ever have. The gameserver test
 * harness cannot advance a room into the seeking phase — the same wall the
 * leaderboard write, the coin award and the cell teleport all sit behind — so
 * every refusal reason is unreachable from a server test. Pulling the decision
 * out as a pure function is what makes it checkable at all.
 *
 * Run: npm run check:shot
 */

import { SHOT, canShoot, facingDot, type ShotRequest } from "../server/src/rules";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

/** A request that succeeds, so each case below can spoil exactly one thing. */
function valid(): ShotRequest {
  return {
    phase: "seeking",
    senderIsSeeker: true,
    target: { role: "hider", caught: false, pos: [0, 0, 10] },
    seekerPos: [0, 0, 0],
    seekerRotY: 0, // yaw 0 faces +Z, straight at the target
    now: 10_000,
    lastShotAt: 0,
  };
}

console.log("\nfacing maths");
{
  // yaw 0 faces +Z. Getting this backwards is the bug that would let a seeker
  // shoot whatever is behind them, and it is invisible from the call site.
  check("dead ahead is 1", Math.abs(facingDot([0, 0, 0], [0, 0, 5], 0) - 1) < 1e-9);
  check("directly behind is -1", Math.abs(facingDot([0, 0, 0], [0, 0, -5], 0) + 1) < 1e-9);
  check("square to the right is 0", Math.abs(facingDot([0, 0, 0], [5, 0, 0], 0)) < 1e-9);
  check("turning to face it restores 1", Math.abs(facingDot([0, 0, 0], [5, 0, 0], Math.PI / 2) - 1) < 1e-9);
  // Height must not enter it: shooting up or down at someone is still facing them.
  check("y is ignored", Math.abs(facingDot([0, 0, 0], [0, 99, 5], 0) - 1) < 1e-9);
  // A target standing exactly on the shooter has no direction; it must not be NaN.
  check("a zero-length direction is finite", Number.isFinite(facingDot([0, 0, 0], [0, 0, 0], 0)));
}

console.log("\nthe shot is allowed");
{
  check("a valid request passes", canShoot(valid()).ok);

  // Distance is deliberately not a factor any more — see the design doc's first
  // section. A target across the whole 88x88 arena is a legal shot.
  const far = valid();
  far.target = { role: "hider", caught: false, pos: [0, 0, 120] };
  check("distance no longer refuses anything", canShoot(far).ok);
}

console.log("\nevery refusal reason");
{
  const cases: [string, ShotRequest, string][] = [];

  const hiding = valid();
  hiding.phase = "hiding";
  cases.push(["shooting during the hiding phase", hiding, "not_seeking"]);

  const lobby = valid();
  lobby.phase = "lobby";
  cases.push(["shooting in the lobby", lobby, "not_seeking"]);

  const hider = valid();
  hider.senderIsSeeker = false;
  cases.push(["a hider pulling the trigger", hider, "not_seeker"]);

  const gone = valid();
  gone.target = null;
  cases.push(["shooting someone who left", gone, "missing"]);

  const seeker = valid();
  seeker.target = { role: "seeker", caught: false, pos: [0, 0, 10] };
  cases.push(["shooting the seeker", seeker, "invalid_target"]);

  const already = valid();
  already.target = { role: "hider", caught: true, pos: [0, 0, 10] };
  cases.push(["shooting someone already caught", already, "invalid_target"]);

  const fast = valid();
  fast.lastShotAt = fast.now - (SHOT.cooldownMs - 1);
  cases.push(["firing one millisecond early", fast, "cooldown"]);

  const behind = valid();
  behind.target = { role: "hider", caught: false, pos: [0, 0, -10] };
  cases.push(["shooting backwards", behind, "not_facing"]);

  for (const [label, request, reason] of cases) {
    const result = canShoot(request);
    check(
      `${label} is refused with ${reason}`,
      !result.ok && result.reason === reason,
      result.ok ? "it was allowed" : `got ${result.reason}`
    );
  }
}

console.log("\nrefusal order when two reasons hold at once");
{
  // An already-caught target AND an active cooldown, simultaneously. This
  // pins which check runs first — not because the order hides anything (the
  // target's caught flag is already public room-user state, so a probing
  // caller learns nothing new either way), but so the order can't drift
  // silently: this exact case passed unnoticed with the two checks swapped
  // until this assertion was added.
  const both = valid();
  both.target = { role: "hider", caught: true, pos: [0, 0, 10] };
  both.lastShotAt = both.now - (SHOT.cooldownMs - 1);
  const result = canShoot(both);
  check(
    "an invalid target during an active cooldown is refused with invalid_target, not cooldown",
    !result.ok && result.reason === "invalid_target",
    result.ok ? "it was allowed" : `got ${result.reason}`
  );
}

console.log("\nthe cooldown's exact edge");
{
  // Both sides of the boundary, off the constant rather than a literal, so
  // changing SHOT.cooldownMs cannot quietly pass.
  const ready = valid();
  ready.lastShotAt = ready.now - SHOT.cooldownMs;
  check(`exactly ${SHOT.cooldownMs}ms after the last shot is allowed`, canShoot(ready).ok);

  const early = valid();
  early.lastShotAt = early.now - (SHOT.cooldownMs - 1);
  check("one millisecond earlier is not", !canShoot(early).ok);
}

console.log("\nthe facing cone's exact edge");
{
  // A target placed at exactly the cone's edge, derived from the constant.
  const angle = Math.acos(SHOT.minFacingDot);
  const onEdge = valid();
  onEdge.target = { role: "hider", caught: false, pos: [Math.sin(angle) * 10, 0, Math.cos(angle) * 10] };
  check(`a target on the cone's edge (dot ${SHOT.minFacingDot}) is allowed`, canShoot(onEdge).ok);

  const outside = valid();
  const wider = angle + 0.05;
  outside.target = { role: "hider", caught: false, pos: [Math.sin(wider) * 10, 0, Math.cos(wider) * 10] };
  check("just outside it is not", !canShoot(outside).ok);
}

console.log("\nrubbish input is refused, not trusted");
{
  const nanPos = valid();
  nanPos.target = { role: "hider", caught: false, pos: [NaN, 0, NaN] };
  check("a non-finite target position cannot pass the facing test", !canShoot(nanPos).ok);

  const noPos = valid();
  noPos.target = { role: "hider", caught: false };
  check("a target with no position at all is refused", !canShoot(noPos).ok);
}

if (failures === 0) {
  console.log("\n✅ the shot decision is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
