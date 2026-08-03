/**
 * Pins down the movement basis and the ground/jump collision behaviour.
 *
 * The strafe sign was wrong once — pressing D moved you left — and nothing in
 * the type system or the rendering catches that. These assertions state the
 * convention explicitly so it can't drift back.
 *
 * Run: npm run check:movement
 */

import {
  canTogglePin,
  createMotionState,
  forwardVector,
  rightVector,
  stepMotion,
  wishDirection,
} from "../game/src/game/movement";
import {
  groundHeightAt,
  moveXZ,
  playerBlockedAt,
  MAP_BOXES,
  ARENA,
  STEP_HEIGHT,
  type MapBox,
} from "../game/src/game/map";
import { bodyFadeFor, cameraInsideSolid, clearCameraDistance } from "../game/src/game/camera";
import { CAMERA, MOVE, SEEKER_SCALE } from "../game/src/game/constants";
import { BODIES, derive } from "../game/src/game/bodies";

let failures = 0;
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nmovement basis (yaw 0 faces +Z)");

{
  const [fx, fz] = forwardVector(0);
  check("forward at yaw 0 is +Z", close(fx, 0) && close(fz, 1), `got (${fx}, ${fz})`);

  const [rx, rz] = rightVector(0);
  // Camera looks along +Z with up +Y, so its screen right is world -X.
  check("right at yaw 0 is -X", close(rx, -1) && close(rz, 0), `got (${rx}, ${rz})`);

  const [wx, wz] = wishDirection(0, 1, 0);
  check("W at yaw 0 moves +Z", close(wx, 0) && close(wz, 1), `got (${wx}, ${wz})`);

  const [dx, dz] = wishDirection(0, 0, 1);
  check("D at yaw 0 moves -X", close(dx, -1) && close(dz, 0), `got (${dx}, ${dz})`);

  const [ax, az] = wishDirection(0, 0, -1);
  check("A at yaw 0 moves +X", close(ax, 1) && close(az, 0), `got (${ax}, ${az})`);
}

{
  // Forward and right must stay perpendicular and unit length at any angle.
  let bad = 0;
  for (let i = 0; i < 64; i++) {
    const yaw = (i / 64) * Math.PI * 2;
    const [fx, fz] = forwardVector(yaw);
    const [rx, rz] = rightVector(yaw);
    if (!close(fx * rx + fz * rz, 0, 1e-12)) bad++;
    if (!close(Math.hypot(fx, fz), 1, 1e-12)) bad++;
    if (!close(Math.hypot(rx, rz), 1, 1e-12)) bad++;
  }
  check("forward ⟂ right and both unit length across a full turn", bad === 0, `${bad} failures`);
}

{
  // right = forward x up, so forward x right = forward x (forward x up) = -up.
  // In the xz plane that means the y-component (fz*sx - fx*sz) must be exactly -1
  // at every yaw; a sign flip here is the strafe-inversion bug coming back.
  let wrong = 0;
  for (let i = 0; i < 64; i++) {
    const yaw = (i / 64) * Math.PI * 2;
    const [fx, fz] = forwardVector(yaw);
    const [sx, sz] = wishDirection(yaw, 0, 1);
    if (!close(fz * sx - fx * sz, -1, 1e-12)) wrong++;
  }
  check("strafe right stays on the right at every yaw", wrong === 0, `${wrong} of 64 flipped`);
}

console.log("\ndiagonals");

{
  const [x, z] = wishDirection(0, 1, 1);
  check("W+D is unit length (no diagonal speed boost)", close(Math.hypot(x, z), 1, 1e-12));

  const [sx, sz] = wishDirection(0.7, 1, 0);
  check("single-axis input keeps full speed", close(Math.hypot(sx, sz), 1, 1e-12));

  const [zx, zz] = wishDirection(1.2, 0, 0);
  check("no input means no movement", close(zx, 0) && close(zz, 0));
}

/**
 * A patch of arena floor with nothing within a metre of it, used by the tests
 * below that need "somewhere ordinary to stand".
 */
const OPEN: [number, number] = (() => {
  const limit = ARENA.size / 2 - 3;
  for (let x = -limit; x <= limit; x += 1) {
    for (let z = -limit; z <= limit; z += 1) {
      const clear = MAP_BOXES.every(
        (b) =>
          // Overhead geometry is not underfoot. Without this the roof — one box
          // covering all 88x88 — makes every square metre of the arena read as
          // occupied and this search throws. 1.8 is isWallAt's own overhead
          // clearance, so "not in the way" means the same here as in map.ts.
          b.p[1] - b.s[1] / 2 > 1.8 ||
          Math.abs(x - b.p[0]) > b.s[0] / 2 + 1 ||
          Math.abs(z - b.p[2]) > b.s[2] / 2 + 1
      );
      if (clear) return [x, z];
    }
  }
  throw new Error("no open floor anywhere in the arena — the clutter has filled it");
})();

console.log("\nnothing can stay wedged inside the arena");
{
  /*
   * The giant seeker used to get stuck in the scenery, and the reason was not
   * that it could get inside something — that follows from step-up being
   * height-aware, since airborne your feet are above a crate's top and a whole
   * prop row stops counting as wall. The reason was that there was no way back
   * out: a sweep found 654 of 3861 inside-a-wall positions the seeker could not
   * walk out of in ANY of sixteen directions.
   *
   * So the guarantee this pins is deliberately stronger than "you can walk out
   * if you pick the right way". It is: a body that finds itself inside the
   * scenery gets put back outside it WITHOUT PRESSING ANYTHING. The drive below
   * feeds moveXZ zero input, which makes the slide a no-op and leaves
   * pushOutOfWalls as the only thing that can move it.
   *
   * Only positions the giant could actually reach are counted. Being unable to
   * escape the middle of a building is not a bug; nobody can be there.
   */
  const R = MOVE.playerRadius * SEEKER_SCALE;
  const AIR = 1.6; // about jump apex — the height a prop row stops blocking at
  const limit = ARENA.size / 2 - R;
  const FRAMES = 60; // one second at 60Hz

  let reachable = 0;
  let stuck = 0;
  let worstFrames = 0;
  let example = "";

  for (let x = -limit; x <= limit; x += 1) {
    for (let z = -limit; z <= limit; z += 1) {
      if (!playerBlockedAt(x, z, 0, R, MAP_BOXES)) continue;
      // Solid interiors are not places a player can be; skip them.
      if (playerBlockedAt(x, z, AIR, R, MAP_BOXES)) continue;
      reachable++;

      let p: [number, number, number] = [x, 0, z];
      let f = 0;
      for (; f < FRAMES; f++) {
        p = moveXZ(p, 0, 0, R, MAP_BOXES);
        if (!playerBlockedAt(p[0], p[2], 0, R, MAP_BOXES)) break;
      }
      if (f >= FRAMES) {
        stuck++;
        if (!example) example = `stuck at (${x}, ${z})`;
      } else if (f > worstFrames) {
        worstFrames = f;
      }
    }
  }

  check(
    `every wedge the giant can reach frees itself with no input ` +
      `(${reachable} positions, worst ${worstFrames} frames)`,
    stuck === 0,
    example
  );
}

console.log("\nground and jumping");

{
  // Standing on open floor. The point is searched for rather than written
  // down: the arena's layout is not this script's business, and a hardcoded
  // coordinate silently becomes a test of "is there still a gap here".
  check(`found an open spot to stand on (${OPEN[0]}, ${OPEN[1]})`, OPEN !== null);
  check("open floor reads height 0", groundHeightAt(OPEN[0], OPEN[1], 0) === 0);

  // A world whose floor is not at y=0. Nothing in the arena needs this, but the
  // seeker's holding cell sits underground, and without it the implicit plane
  // at zero yanks anything below it back up to the surface.
  {
    const deep = -8;
    check(
      `an empty world with floorY ${deep} reads that height, not 0`,
      groundHeightAt(0, 0, deep, [], deep) === deep
    );
    check(
      "a box below the surface is still standable",
      groundHeightAt(0, 0, deep, [{ p: [0, deep + 0.2, 0], s: [2, 0.4, 2], c: 0 }], deep) ===
        deep + 0.4
    );
    check(
      "omitting floorY keeps the old behaviour",
      groundHeightAt(0, 0, 0, []) === 0
    );
  }

  // Step-up is what stops a player walking up the side of cover without
  // jumping. Both sides of the threshold are pinned, off the constant itself
  // rather than a literal, so raising STEP_HEIGHT can't quietly pass.
  {
    const at = (h: number) =>
      groundHeightAt(40, 40, 0, [{ p: [40, h / 2, 40], s: [2, h, 2], c: 0 }]);

    check(
      `a box just under STEP_HEIGHT (${STEP_HEIGHT}) is walked onto`,
      close(at(STEP_HEIGHT - 0.01), STEP_HEIGHT - 0.01)
    );
    check(
      "a box just over STEP_HEIGHT is not — it needs a jump",
      at(STEP_HEIGHT + 0.01) === 0
    );
  }

  {
    // A step you can take is one you could physically lift a foot over. Tied to
    // the real hip heights so STEP_HEIGHT can't drift back up to waist level,
    // which is exactly how crates became walkable ramps.
    const lowestHip = Math.min(...BODIES.map((b) => derive(b).hipY));
    check(
      `STEP_HEIGHT stays below every profile's hips (lowest ${lowestHip.toFixed(2)})`,
      STEP_HEIGHT < lowestHip,
      `STEP_HEIGHT ${STEP_HEIGHT} would be a climb, not a step`
    );

    // Jumping has to be worth doing: it must clear meaningfully more than
    // walking does. apex = v^2 / 2g.
    const apex = (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity);
    check(
      `a jump (apex ${apex.toFixed(2)}) reaches well above the free step`,
      apex > STEP_HEIGHT * 2,
      `apex ${apex.toFixed(2)} vs STEP_HEIGHT ${STEP_HEIGHT} — jumping barely beats walking`
    );
  }

  {
    // The unit checks above ask groundHeightAt directly. This drives the real
    // integrator into a crate the way a player would, because "walked up onto
    // it without jumping" is a claim about stepMotion, not about one helper.
    const crate = [{ p: [0, 0.5, 4], s: [3, 1, 3], c: 0 }] as typeof MAP_BOXES;
    const walk = (jump: boolean) => {
      const st = createMotionState([0, 0, 0]);
      let peakY = 0;
      for (let i = 0; i < 180; i++) {
        // yaw 0 faces +Z, so forward walks straight at the crate.
        stepMotion(st, { forward: 1, strafe: 0, jump }, 0, {
          boxes: crate,
          dt: 1 / 60,
          now: i * (1000 / 60),
          speed: MOVE.hiderSpeed,
          radius: MOVE.playerRadius,
        });
        peakY = Math.max(peakY, st.pos[1]);
      }
      return { pos: st.pos, peakY };
    };

    // Peak, not final: at the old STEP_HEIGHT the player walked up onto the
    // crate, across it and down the far side, ending back at y=0 having very
    // much climbed it. Only the high-water mark states the actual claim.
    const walked = walk(false);
    check(
      `walking into a 1.0u crate never leaves the floor (peak y=${walked.peakY.toFixed(2)})`,
      walked.peakY === 0,
      "the player rose without jumping — step-up is acting as a ramp"
    );
    check(
      `...and is stopped short of it (ended z=${walked.pos[2].toFixed(2)})`,
      walked.pos[2] < 4 - 3 / 2
    );
  }

  // Landing on a tall box from above must still work — asserted against
  // synthetic geometry so it holds whatever the arena happens to contain.
  {
    const tall = [{ p: [40, 1.5, 44] as [number, number, number], s: [2, 3, 2] as [number, number, number], c: 0 }];
    check("a 3.0u box is not steppable from the floor", groundHeightAt(40, 44, 0, tall) === 0);
    check("...but is landable from above", groundHeightAt(40, 44, 3, tall) === 3);
  }

  // What the arena's own boxes may and may not be climbed is now check:map's
  // job: the redesigned map deliberately contains pallets you walk over, so a
  // blanket "the shortest arena box needs a jump" is no longer true, and the
  // per-family rules need the family table to state them against.
}

{
  // A jump has to clear a low crate; tune gravity/jumpSpeed together.
  const apex = (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity);
  check(`jump apex ${apex.toFixed(2)}u clears a 1.0u crate`, apex > 1.0, `apex=${apex.toFixed(3)}`);
  check(`jump apex stays under the ${ARENA.wallHeight}u walls`, apex < ARENA.wallHeight);
}

{
  // moveXZ must not change height — the caller owns gravity.
  const from: [number, number, number] = [20, 3.5, 20];
  const to = moveXZ(from, 0.3, 0.2, MOVE.playerRadius);
  check("moveXZ leaves height untouched", to[1] === 3.5, `got ${to[1]}`);

  // And it must keep the player inside the arena.
  const limit = ARENA.size / 2 - MOVE.playerRadius;
  const pushed = moveXZ([limit - 0.1, 0, 0], 5, 0, MOVE.playerRadius);
  check("arena bounds hold", pushed[0] <= limit + 1e-9, `got ${pushed[0]}`);
}

console.log("\ncorner escape");

{
  // What this pins is moveXZ's push-out: before it, a player holding pure
  // forward into a concave corner froze for 3.75 seconds once both per-axis
  // checks failed at once. It used to test that against a pinch that happened
  // to exist in the live map at [5.0, 12.3] — which broke the day the clutter
  // was rebuilt, because a check aimed at movement code was really pinned to
  // a layout. So the corner is now synthetic: two boxes forming an L, walked
  // into diagonally, the exact shape the original bug needed. The live map's
  // own worst pockets are the walkability checks' business in check:map.
  // Two prop-sized boxes forming a genuine dead-end inside corner. Any
  // heading between the two face normals has no free tangent, so pure forward
  // cannot slide out — every frame both axes are blocked at once, which is
  // precisely the state that used to freeze the player solid (3.75s at the
  // pinch that existed in the old layout; unbounded in a corner like this).
  // The push-out's guarantee is that its accumulated displacement still works
  // the body loose in a couple of seconds even here, where sliding cannot.
  const corner: MapBox[] = [
    { p: [1.0, 1, 0], s: [1.3, 2, 1.3], c: 0 },
    { p: [0, 1, 1.0], s: [1.3, 2, 1.3], c: 0 },
  ];
  const state = createMotionState([1.8, 0, 1.8]);
  // Into the corner, a shade off the exact diagonal. The perfect diagonal is
  // a knife-edge this engine has never promised anything about — the push-out
  // direction flips sides every frame and freeing takes ~1.5s. Any real
  // approach is askew, and askew is what the original 3.75s freeze was too.
  const heading = Math.atan2(-1, -1) + 0.12;
  const dt = 1 / 60;
  let stuckFrames = 0;
  let maxStuck = 0;
  for (let i = 0; i < 300; i++) {
    const before: [number, number] = [state.pos[0], state.pos[2]];
    stepMotion(state, { forward: 1, strafe: 0, jump: false }, heading, {
      boxes: corner,
      dt,
      now: i * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
    });
    const moved = Math.hypot(state.pos[0] - before[0], state.pos[2] - before[1]);
    if (i > 10 && moved < 0.003) {
      stuckFrames++;
      maxStuck = Math.max(maxStuck, stuckFrames);
    } else {
      stuckFrames = 0;
    }
  }
  const stallSeconds = maxStuck / 60;
  // The walker ENDS parked against the corner, and that is correct — pure
  // forward into a dead end has nowhere to go, and a real player unsticks by
  // steering. What must not happen is the dead freeze: with the push-out
  // disabled this same run spends 4.77 of its 5 seconds in a sub-3mm-per-frame
  // stall, because both per-axis checks fail at once and all motion stops.
  // With it, the longest such stall stays under 2s and the body visibly keeps
  // responding.
  check(
    `pure-forward into a dead-end corner never freezes for 2s (worst stall ${stallSeconds.toFixed(2)}s)`,
    stallSeconds < 2
  );
}

console.log("\ncamera collision");

{
  const openTarget = { x: OPEN[0], y: 1.35, z: OPEN[1] };
  check(
    "unobstructed view keeps the full distance",
    clearCameraDistance(openTarget, { x: 0, y: 1, z: 0 }, 5.2, CAMERA.minDistance) === 5.2
  );
  check(
    "camera never drops below the floor",
    clearCameraDistance(openTarget, { x: 0, y: -1, z: 0 }, 5.2, CAMERA.minDistance) < 1.1
  );
}

{
  // Aim the camera through an interior crate: it must stop on the player's side
  // rather than finding the open space beyond it.
  const crate = MAP_BOXES.find(
    (b) => b.s[1] > 2.5 && b.s[0] < 6 && Math.abs(b.p[0]) < 16 && Math.abs(b.p[2]) < 16
  );
  if (crate) {
    const gap = crate.s[0] / 2 + 1.5;
    const target = { x: crate.p[0] - gap, y: 1.35, z: crate.p[2] };
    const d = clearCameraDistance(target, { x: 1, y: 0, z: 0 }, 5.2, CAMERA.minDistance);
    check(`camera stops before a crate ${gap.toFixed(2)}u away (got ${d.toFixed(2)}u)`, d < gap);
  }
}

{
  // Sweep the arena: no camera placement may end up inside geometry.
  let embedded = 0;
  let sampled = 0;
  for (let i = 0; i < 3000; i++) {
    const x = (Math.random() * 2 - 1) * 20;
    const z = (Math.random() * 2 - 1) * 20;
    const standable = !MAP_BOXES.some(
      (b) =>
        b.p[1] + b.s[1] / 2 > 1.15 &&
        Math.abs(x - b.p[0]) < b.s[0] / 2 + MOVE.playerRadius &&
        Math.abs(z - b.p[2]) < b.s[2] / 2 + MOVE.playerRadius
    );
    if (!standable) continue;
    sampled++;

    const yaw = Math.random() * Math.PI * 2;
    const pitch = -0.6 + Math.random() * 1.7;
    const target = { x, y: 1.35, z };
    const back = {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
    const d = clearCameraDistance(target, back, 5.2, CAMERA.minDistance);
    if (cameraInsideSolid(target.x + back.x * d, target.y + back.y * d, target.z + back.z * d)) {
      embedded++;
    }
  }
  check(
    `camera never lands inside geometry (${sampled} placements)`,
    embedded === 0,
    `${embedded} embedded`
  );
}

console.log("\nfirst-person handoff");

{
  const f = (d: number) => bodyFadeFor(d, CAMERA.fadeEnd, CAMERA.fadeStart);

  check("solid at the normal follow distance", f(CAMERA.playDistance) === 1);
  check("fully hidden at the near threshold", f(CAMERA.fadeEnd) === 0);
  check("partially faded in between", close(f((CAMERA.fadeEnd + CAMERA.fadeStart) / 2), 0.5, 1e-9));

  // The two thresholds have to stay consistent with each other:
  // the worst pull-in the occluder can produce must leave the body invisible...
  check(
    "the tightest pull-in leaves the body hidden",
    f(CAMERA.minDistance) === 0,
    `minDistance ${CAMERA.minDistance} vs fadeEnd ${CAMERA.fadeEnd}`
  );
  // ...while paint mode must never be able to hide what you're painting.
  check(
    "paint mode's closest distance keeps the body visible",
    f(CAMERA.paintMinDistance) > 0,
    `paintMinDistance ${CAMERA.paintMinDistance} vs fadeEnd ${CAMERA.fadeEnd}`
  );

  // The pivot rises to eye level exactly as the body disappears, so the
  // transition lands on a real first-person view rather than a floating one.
  check("eye height sits above shoulder height", CAMERA.eyeHeight > CAMERA.shoulderHeight);
  check(
    "body is gone by the time the pivot reaches the eyes",
    f(CAMERA.fadeEnd) === 0 && CAMERA.eyeHeight - CAMERA.shoulderHeight < 0.4
  );

  let monotonic = true;
  for (let d = 0; d < 3; d += 0.05) if (f(d) > f(d + 0.05) + 1e-9) monotonic = false;
  check("fade never reverses as the camera pulls away", monotonic);
}

console.log("\njump shape (drives the airborne animation)");

console.log("\nposition pin");
{
  check("a grounded hider can pin", canTogglePin("hider", true, false, false));
  check("a wall-latched hider can pin", canTogglePin("hider", false, true, false));
  check("unsupported mid-air pinning stays disabled", !canTogglePin("hider", false, false, false));
  check("an existing pin can always be released", canTogglePin("hider", false, false, true));
  check("a seeker can never pin", !canTogglePin("seeker", true, true, false));
}

console.log("\nwall hold");

{
  const wall = [{
    p: [0, 10, 0] as [number, number, number],
    s: [1, 20, 8] as [number, number, number],
    c: 0,
  }];
  const state = createMotionState([-(0.5 + MOVE.playerRadius), 0, 0]);
  const dt = 1 / 60;

  // Holding Space continuously climbs rather than merely cancelling gravity.
  for (let i = 0; i < 60; i++) {
    stepMotion(state, { forward: 0, strafe: 0, jump: true }, 0, {
      boxes: wall,
      dt,
      now: i * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
      worldHalfSize: 20,
    });
  }
  const climbedY = state.pos[1];
  check("holding jump against a wall climbs continuously", !state.grounded && climbedY > 2);
  check("wall climb uses its configured upward speed", state.vy === MOVE.wallClimbSpeed);

  // Let go without moving: remain fixed at the release height.
  for (let i = 0; i < 60; i++) {
    stepMotion(state, { forward: 0, strafe: 0, jump: false }, 0, {
      boxes: wall,
      dt,
      now: (60 + i) * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
      worldHalfSize: 20,
    });
  }
  check("releasing jump while idle holds the exact height", close(state.pos[1], climbedY));
  check("the released wall latch has no vertical drift", state.vy === 0);

  // Movement after release breaks the latch even when that movement runs
  // along the same wall and therefore does not itself lose contact.
  for (let i = 0; i < 120 && !state.grounded; i++) {
    stepMotion(state, { forward: 1, strafe: 0, jump: false }, 0, {
      boxes: wall,
      dt,
      now: (120 + i) * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
      worldHalfSize: 20,
    });
  }
  check("moving after release breaks the latch and lands", state.grounded && state.pos[1] === 0);
}

{
  const boxes = [
    {
      p: [0, 10, 0] as [number, number, number],
      s: [1, 20, 8] as [number, number, number],
      c: 0,
    },
    {
      p: [-1, 5.5, 0] as [number, number, number],
      s: [4, 1, 8] as [number, number, number],
      c: 0,
    },
  ];
  const state = createMotionState([-(0.5 + MOVE.playerRadius), 0, 0]);
  const dt = 1 / 60;
  for (let i = 0; i < 300; i++) {
    stepMotion(state, { forward: 0, strafe: 0, jump: true }, 0, {
      boxes,
      dt,
      now: i * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
      worldHalfSize: 20,
    });
  }
  // Ceiling underside is y=5 and the normal body is 1.8u tall.
  check(
    "wall climbing stops with the head below a ceiling",
    close(state.pos[1], 3.2),
    `feet y=${state.pos[1].toFixed(3)}`
  );
  check("ceiling contact cancels upward velocity", state.vy === 0);
}

{
  // Simulate a real jump from open ground. The rig reads `grounded` and `vy` to
  // decide tuck vs reach, so the airborne window has to last long enough to see
  // and vy has to actually change sign partway through.
  const state = createMotionState([20, 0, 20]);
  const dt = 1 / 60;
  let airFrames = 0;
  let peak = 0;
  let sawRise = false;
  let sawFall = false;

  for (let i = 0; i < 240; i++) {
    // Hold jump for the first frame only — a real tap, not a held key.
    const jump = i === 1;
    stepMotion(state, { forward: 0, strafe: 0, jump }, 0, {
      boxes: MAP_BOXES,
      dt,
      now: i * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
    });
    if (!state.grounded) {
      airFrames++;
      peak = Math.max(peak, state.pos[1]);
      if (state.vy > 0.5) sawRise = true;
      if (state.vy < -0.5) sawFall = true;
    } else if (airFrames > 0) {
      break;
    }
  }

  const airtime = airFrames * dt;
  check(`airtime is ${airtime.toFixed(2)}s — long enough to animate`, airtime > 0.4);
  check("airtime isn't floaty", airtime < 1.4, `${airtime.toFixed(2)}s`);
  check(`peak height ${peak.toFixed(2)}u matches the analytic apex`, Math.abs(peak - (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity)) < 0.15);
  check("rise and fall are both distinguishable by vy", sawRise && sawFall);
  check("the player lands again", airFrames > 0 && !state.grounded === false);
}

{
  // Walking must produce a speed the gait can scale against; a walk cycle keyed
  // to a speed that never arrives would just never play.
  const state = createMotionState([20, 0, 20]);
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) {
    stepMotion(state, { forward: 1, strafe: 0, jump: false }, 0, {
      boxes: MAP_BOXES,
      dt,
      now: i * dt * 1000,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
    });
  }
  const speed = Math.hypot(state.vel[0], state.vel[1]);
  check(
    `sustained walk reaches ${speed.toFixed(2)}u/s (target ${MOVE.hiderSpeed})`,
    speed > MOVE.hiderSpeed * 0.95
  );
  check("walking sets the moving flag", state.moving);
  check("walking stays grounded", state.grounded);
}

if (failures === 0) {
  console.log("\n✅ movement is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
