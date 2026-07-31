/**
 * Guards the unavoidable duplications in this project.
 *
 * The server runs in an isolated VM and cannot import from src/, so anything
 * both sides need exists twice. If the two drift, the server acts on values
 * players never see — a silent bug that no type check or unit test on either
 * side alone would catch.
 *
 * The map itself used to be the big one. It isn't duplicated any more: the
 * server holds hand-picked SPAWN_POINTS instead of ~90 boxes, so that is what
 * this script compares now.
 *
 * Run: npm run check:sync
 */

import {
  MAP_BOXES as CLIENT_BOXES,
  ARENA as CLIENT_ARENA,
  SPAWN_POINTS as CLIENT_SPAWNS,
} from "../game/src/game/arena";
import { playerBlockedAt } from "../game/src/game/map";
import { BODIES } from "../game/src/game/bodies";
import { POSES, MOVE, PAINT as CLIENT_PAINT, SHOT as CLIENT_SHOT } from "../game/src/game/constants";
import { CELL_SPAWN as CLIENT_CELL, HUNT_START as CLIENT_HUNT_START } from "../game/src/game/cell";
import {
  ARENA as SERVER_ARENA,
  SPAWN_POINTS as SERVER_SPAWNS,
  CELL_SPAWN as SERVER_CELL,
  HUNT_START as SERVER_HUNT_START,
  POSE_COUNT as SERVER_POSE_COUNT,
  MOVE_SPEED_CAP,
  AVATAR_PRICES,
  SHOT as SERVER_SHOT,
  PAINT_LIMITS as SERVER_PAINT,
} from "../server/src/rules";

let failures = 0;

function fail(msg: string) {
  console.error("  ✗ " + msg);
  failures++;
}

function pass(msg: string) {
  console.log("  ✓ " + msg);
}

console.log("\narena");

if (
  CLIENT_ARENA.size !== SERVER_ARENA.size ||
  CLIENT_ARENA.wallHeight !== SERVER_ARENA.wallHeight ||
  CLIENT_ARENA.wallThickness !== SERVER_ARENA.wallThickness
) {
  fail(`arena dimensions differ: ${JSON.stringify(CLIENT_ARENA)} vs ${JSON.stringify(SERVER_ARENA)}`);
} else {
  pass(`arena ${CLIENT_ARENA.size}x${CLIENT_ARENA.size} matches`);
}

console.log("\nspawn points");

// The server no longer holds a map. The only geometry contract left is where
// hiders start, so this is now the whole of it.
if (CLIENT_SPAWNS.length !== SERVER_SPAWNS.length) {
  fail(`spawn point count differs: client ${CLIENT_SPAWNS.length}, server ${SERVER_SPAWNS.length}`);
} else {
  let bad = 0;
  for (let i = 0; i < CLIENT_SPAWNS.length; i++) {
    if (CLIENT_SPAWNS[i][0] !== SERVER_SPAWNS[i][0] || CLIENT_SPAWNS[i][1] !== SERVER_SPAWNS[i][1]) {
      if (bad < 3) {
        fail(
          `spawn ${i} differs: client [${CLIENT_SPAWNS[i]}], server [${SERVER_SPAWNS[i]}]`
        );
      }
      bad++;
    }
  }
  if (bad === 0) pass(`${CLIENT_SPAWNS.length} spawn points identical on both sides`);
  else fail(`${bad} spawn points differ in total`);
}

console.log("\nholding cell");

// The server spawns the seeker here and never simulates the room around it, so
// a drift would drop them outside the cell with no wall to stop them.
if (CLIENT_CELL.some((v, i) => v !== SERVER_CELL[i])) {
  fail(`cell spawn differs: client [${CLIENT_CELL}], server [${SERVER_CELL}]`);
} else {
  pass(`cell spawn [${CLIENT_CELL}] matches on both sides`);
}

// The exit half of the same contract: the server teleports the seeker here
// when the hunt starts, and never simulates anything past that write.
if (CLIENT_HUNT_START.some((v, i) => v !== SERVER_HUNT_START[i])) {
  fail(`hunt start differs: client [${CLIENT_HUNT_START}], server [${SERVER_HUNT_START}]`);
} else {
  pass(`hunt start [${CLIENT_HUNT_START}] matches on both sides`);
}

console.log("\npose count");

// The server clamps an incoming pose index to POSE_COUNT - 1. If it's smaller
// than the client's real pose list, the last poses in the menu (the ones added
// most recently) silently get clamped down to an earlier one the instant the
// choice reaches the server, even though the client keeps rendering the one
// the player actually picked.
if (SERVER_POSE_COUNT !== POSES.length) {
  fail(
    `server clamps poses to ${SERVER_POSE_COUNT}, but the client offers ${POSES.length} ` +
      `(${POSES.map((p) => p.id).join(", ")})`
  );
} else {
  pass(`both sides agree on ${POSES.length} poses`);
}

console.log("\nmovement speed cap");

// The server clamps reported movement to this speed regardless of role (see
// the movement-validation design doc) — it must never be slower than the
// fastest real role, or legitimate seekers get clamped mid-chase.
const fastestClientSpeed = Math.max(MOVE.hiderSpeed, MOVE.seekerSpeed);
if (MOVE_SPEED_CAP < fastestClientSpeed) {
  fail(
    `server caps movement at ${MOVE_SPEED_CAP}u/s, but the client's fastest role moves at ` +
      `${fastestClientSpeed}u/s — legitimate players would get clamped`
  );
} else {
  pass(`server cap ${MOVE_SPEED_CAP}u/s covers the client's fastest role (${fastestClientSpeed}u/s)`);
}

console.log("\nshot rules");

// The client refuses a shot locally before asking — useShoot.ts mirrors both
// the cooldown and the facing cone — so a drift shows up as the client blocking
// shots the server would have allowed, or asking for ones it always refuses.
//
// Key sets first, then values, the same shape as the avatar catalogue below:
// comparing only the two fields we know about today would stay green if a
// maxDistance (or any other rule) were added back to one copy alone, which is
// exactly the drift this script exists to catch.
{
  const clientKeys = Object.keys(CLIENT_SHOT).sort();
  const serverKeys = Object.keys(SERVER_SHOT).sort();

  if (clientKeys.join(",") !== serverKeys.join(",")) {
    fail(`shot rule keys differ: client [${clientKeys.join(", ")}], server [${serverKeys.join(", ")}]`);
  } else {
    pass(`both sides define the same ${clientKeys.length} shot rules (${clientKeys.join(", ")})`);

    const client = CLIENT_SHOT as Record<string, unknown>;
    const server = SERVER_SHOT as Record<string, unknown>;
    const mismatched = clientKeys.filter((k) => client[k] !== server[k]);
    if (mismatched.length) {
      for (const k of mismatched) {
        fail(`shot rule ${k} is ${String(client[k])} on the client but ${String(server[k])} on the server`);
      }
    } else {
      pass(`shot rules match (dot ${CLIENT_SHOT.minFacingDot}, cooldown ${CLIENT_SHOT.cooldownMs}ms)`);
    }
  }
}

console.log("\npaint limits");

// The client converts a world-sized brush into a texel radius and clamps it to
// PAINT.maxRadius before sending. The server clamps what it relays. If those
// two numbers drift apart the painter is the only person who sees the dab they
// painted — everyone else gets the server's clamped version. Key sets first,
// then values, the same shape as the shot rules above.
{
  const clientKeys = Object.keys(CLIENT_PAINT).sort();
  const serverKeys = Object.keys(SERVER_PAINT).sort();

  if (clientKeys.join(",") !== serverKeys.join(",")) {
    fail(`paint limit keys differ: client [${clientKeys.join(", ")}], server [${serverKeys.join(", ")}]`);
  } else {
    const client = CLIENT_PAINT as Record<string, unknown>;
    const server = SERVER_PAINT as Record<string, unknown>;
    const mismatched = clientKeys.filter((k) => client[k] !== server[k]);
    if (mismatched.length) {
      for (const k of mismatched) {
        fail(`paint limit ${k} is ${String(client[k])} on the client but ${String(server[k])} on the server`);
      }
    } else {
      pass(`paint limits match (radius ${CLIENT_PAINT.maxRadius}, batch ${CLIENT_PAINT.maxBatch})`);
    }
  }
}

console.log("\navatar catalogue");

// The client shows a price; the server charges one. If they drift, a player is
// billed an amount the shop never displayed — and the server always wins.
{
  const clientIds = BODIES.map((b) => b.id).sort();
  const serverIds = Object.keys(AVATAR_PRICES).sort();

  if (clientIds.join(",") !== serverIds.join(",")) {
    fail(`avatar ids differ: client [${clientIds.join(", ")}], server [${serverIds.join(", ")}]`);
  } else {
    pass(`both sides offer the same ${clientIds.length} avatars`);

    const mismatched = BODIES.filter((b) => AVATAR_PRICES[b.id] !== b.price);
    if (mismatched.length) {
      for (const b of mismatched) {
        fail(`${b.id} costs ${b.price} on the client but ${AVATAR_PRICES[b.id]} on the server`);
      }
    } else {
      pass("every price matches");
    }
  }
}

console.log("\nspawn safety");

// The server can no longer test a spawn against the map, because it no longer
// has one — it just hands out points from its list. So every point on that
// list has to be somewhere a player actually fits, judged by the client's real
// collision rules rather than a re-implementation of them.
{
  const inside = SERVER_SPAWNS.filter(([x, z]) =>
    playerBlockedAt(x, z, 0, MOVE.playerRadius, CLIENT_BOXES)
  );
  if (inside.length) {
    for (const p of inside.slice(0, 3)) fail(`server spawn [${p}] lands inside client geometry`);
    if (inside.length > 3) fail(`${inside.length} server spawns land inside client geometry in total`);
  } else {
    pass(`all ${SERVER_SPAWNS.length} server spawns are clear of client collision`);
  }
}

if (failures === 0) {
  console.log("\n✅ client and server agree\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s) — src/game/map.ts and server/src/rules.ts have drifted\n`);
  process.exit(1);
}
