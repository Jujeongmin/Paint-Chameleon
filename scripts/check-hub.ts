/**
 * The hub has exactly one job: let a player walk from the spawn point into a
 * portal. If an arch pillar or a prop blocks that path there is no way to start
 * a match at all, and nothing else in the build would catch it.
 *
 * So this walks the real physics — the same stepMotion the game uses — from the
 * spawn to each portal and checks it arrives.
 *
 * Run: npm run check:hub
 */

import { HUB, HUB_BOXES, PORTALS, SHOP, atShop, portalAt } from "../src/hub/hubMap";
import { createMotionState, stepMotion } from "../src/game/movement";
import { groundHeightAt, playerBlockedAt } from "../src/game/map";
import { MOVE } from "../src/game/constants";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

/**
 * Ask the game's own predicate rather than reimplementing it — a hand-rolled
 * copy forgets things like overhead clearance and then reports an archway
 * lintel four metres up as a blocked doorway.
 */
function occupied(x: number, z: number): boolean {
  return playerBlockedAt(x, z, 0, MOVE.playerRadius, HUB_BOXES);
}

/**
 * Walks toward a target using the game's own integrator, steering around
 * obstacles the way the bots do. Returns the distance it got to.
 */
function walkTo(target: [number, number], maxSeconds = 25): number {
  const state = createMotionState(HUB.spawn);
  const dt = 1 / 60;
  let best = Infinity;

  for (let i = 0; i < maxSeconds / dt; i++) {
    const dx = target[0] - state.pos[0];
    const dz = target[1] - state.pos[2];
    const dist = Math.hypot(dx, dz);
    best = Math.min(best, dist);
    if (dist < 0.4) break;

    // Face the target, then try widening deviations if we stop making progress.
    const before: [number, number] = [state.pos[0], state.pos[2]];
    const base = Math.atan2(dx, dz);
    const offsets = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6];

    for (const off of offsets) {
      const probe = { ...state, pos: [...state.pos] as [number, number, number], vel: [...state.vel] as [number, number] };
      stepMotion(probe, { forward: 1, strafe: 0, jump: false }, base + off, {
        boxes: HUB_BOXES,
        dt,
        now: i * dt * 1000,
        speed: MOVE.hiderSpeed,
        radius: MOVE.playerRadius,
      });
      const moved = Math.hypot(probe.pos[0] - before[0], probe.pos[2] - before[1]);
      if (moved > 0.005 || off === offsets[offsets.length - 1]) {
        state.pos = probe.pos;
        state.vel = probe.vel;
        state.vy = probe.vy;
        state.grounded = probe.grounded;
        state.lastGroundedAt = probe.lastGroundedAt;
        break;
      }
    }
  }
  return best;
}

console.log("\nhub layout");

check("spawn point is clear of geometry", !occupied(HUB.spawn[0], HUB.spawn[2]));
check("spawn point rests on the floor", groundHeightAt(HUB.spawn[0], HUB.spawn[2], 0, HUB_BOXES) === 0);
check("hub has at least one usable portal", PORTALS.some((p) => p.available));

{
  // Two overlapping triggers would make which match you join ambiguous.
  let overlapping = 0;
  for (let i = 0; i < PORTALS.length; i++) {
    for (let j = i + 1; j < PORTALS.length; j++) {
      const a = PORTALS[i];
      const b = PORTALS[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) < a.triggerRadius + b.triggerRadius) overlapping++;
    }
  }
  check("portal triggers don't overlap", overlapping === 0, `${overlapping} overlapping pairs`);
}

{
  // A shop trigger overlapping a portal's would make walking toward one open
  // the other — same ambiguity the portal-portal check above guards against.
  let overlapping = 0;
  for (const p of PORTALS) {
    if (Math.hypot(SHOP.x - p.x, SHOP.z - p.z) < SHOP.triggerRadius + p.triggerRadius) overlapping++;
  }
  check("shop trigger doesn't overlap any portal trigger", overlapping === 0, `${overlapping} overlapping pairs`);
}

console.log("\nportal detection");

for (const p of PORTALS) {
  check(`${p.id}: standing in the arch is detected`, portalAt(p.x, p.z)?.id === p.id);
  check(
    `${p.id}: just outside the trigger is not`,
    portalAt(p.x + p.triggerRadius + 0.5, p.z) === null ||
      portalAt(p.x + p.triggerRadius + 0.5, p.z)?.id !== p.id
  );
}

check("open floor is not a portal", portalAt(HUB.spawn[0], HUB.spawn[2]) === null);

console.log("\nshop detection");

check("standing at the shop centre is detected", atShop(SHOP.x, SHOP.z));
check(
  "well outside the shop trigger is not",
  !atShop(SHOP.x + SHOP.triggerRadius + 0.5, SHOP.z)
);

console.log("\nreachability (walking the real physics from spawn)");

for (const p of PORTALS) {
  check(
    `${p.id}: the trigger is standable`,
    !occupied(p.x, p.z),
    "an arch pillar or prop is sitting in the doorway"
  );

  const closest = walkTo([p.x, p.z]);
  check(
    `${p.id}: reachable on foot (got within ${closest.toFixed(2)}u)`,
    closest <= p.triggerRadius,
    `never got closer than ${closest.toFixed(2)}u, trigger radius is ${p.triggerRadius}`
  );
}

check(
  "shop: the trigger centre is standable",
  !occupied(SHOP.x, SHOP.z),
  "the shop counter is sitting on top of its own trigger"
);

{
  const closest = walkTo([SHOP.x, SHOP.z]);
  check(
    `shop: reachable on foot (got within ${closest.toFixed(2)}u)`,
    closest <= SHOP.triggerRadius,
    `never got closer than ${closest.toFixed(2)}u, trigger radius is ${SHOP.triggerRadius}`
  );
}

if (failures === 0) {
  console.log("\n✅ hub is traversable\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
