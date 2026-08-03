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

import { SHOT, canFireAsSeeker, canShoot, facingDot, type ShotRequest } from "../server/src/rules";

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
    senderMissing: false,
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

console.log("\nwho can pull the trigger");
{
  check("the original seeker role can fire", canFireAsSeeker({ role: "seeker" }));
  check("a hider converted to seeker can also fire", canFireAsSeeker({ role: "seeker" }));
  check("a live hider cannot fire", !canFireAsSeeker({ role: "hider" }));
  check("missing sender state cannot fire", !canFireAsSeeker(null));
}

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

  // The shooter's own room-user state can be legitimately absent (see the
  // "shot is refused outside the seeking phase" server test, caught right
  // after joinGame). If it is, the request must be refused outright rather
  // than falling through to defaulted seekerPos/seekerRotY/lastShotAt values
  // that would otherwise be trusted as real state.
  const noSender = valid();
  noSender.senderMissing = true;
  cases.push(["the shooter's own state is missing", noSender, "sender_missing"]);

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

console.log("\nphase and senderIsSeeker win over cooldown and facing, too");
{
  // rules.ts's canShoot docstring claims the cheap state checks (phase,
  // senderIsSeeker) run before the geometry checks (cooldown, facing). The
  // block above only pins invalid_target-before-cooldown; nothing pinned the
  // other half of that claim. Each case here is wrong on three axes at once —
  // phase (or senderIsSeeker), cooldown, and facing — so if either state
  // check were ever moved after cooldown or facing, the reason returned here
  // would silently change and this assertion would catch it.
  const wrongPhase = valid();
  wrongPhase.phase = "hiding";
  wrongPhase.lastShotAt = wrongPhase.now - (SHOT.cooldownMs - 1); // inside cooldown too
  wrongPhase.target = { role: "hider", caught: false, pos: [0, 0, -10] }; // facing backwards too
  const phaseResult = canShoot(wrongPhase);
  check(
    "wrong phase + active cooldown + facing backwards is refused with not_seeking",
    !phaseResult.ok && phaseResult.reason === "not_seeking",
    phaseResult.ok ? "it was allowed" : `got ${phaseResult.reason}`
  );

  const notSeeker = valid();
  notSeeker.senderIsSeeker = false;
  notSeeker.lastShotAt = notSeeker.now - (SHOT.cooldownMs - 1); // inside cooldown too
  notSeeker.target = { role: "hider", caught: false, pos: [0, 0, -10] }; // facing backwards too
  const seekerResult = canShoot(notSeeker);
  check(
    "not the seeker + active cooldown + facing backwards is refused with not_seeker",
    !seekerResult.ok && seekerResult.reason === "not_seeker",
    seekerResult.ok ? "it was allowed" : `got ${seekerResult.reason}`
  );
}

console.log("\nsenderMissing wins over target, cooldown and facing, too");
{
  // The "the shooter's own state is missing" case above spoils exactly one
  // thing, so it would still answer sender_missing with the check moved
  // anywhere in canShoot — it pins the reason but not the position. This case
  // is wrong on four axes at once: sender missing, no target at all, inside
  // the cooldown, and turned away. That pins the position canShoot's docstring
  // claims, which is the whole safety argument: senderMissing must run before
  // target/cooldown/facing, because those three would otherwise be handed the
  // caller's defaults for state that does not exist ([0,0,0], yaw 0,
  // lastShotAt 0 — a plausible arena position facing +Z with no cooldown).
  const missing = valid();
  missing.senderMissing = true;
  missing.target = null; // the target is gone too
  missing.lastShotAt = missing.now - (SHOT.cooldownMs - 1); // inside the cooldown too
  missing.seekerRotY = Math.PI; // and turned away from where the target was
  const result = canShoot(missing);
  check(
    "a missing sender with no target, inside the cooldown and facing backwards is refused with sender_missing",
    !result.ok && result.reason === "sender_missing",
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
