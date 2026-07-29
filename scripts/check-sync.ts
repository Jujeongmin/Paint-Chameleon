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
} from "../src/game/arena";
import { playerBlockedAt } from "../src/game/map";
import { BODIES } from "../src/game/bodies";
import { POSES, MOVE } from "../src/game/constants";
import {
  ARENA as SERVER_ARENA,
  SPAWN_POINTS as SERVER_SPAWNS,
  POSE_COUNT as SERVER_POSE_COUNT,
  MOVE_SPEED_CAP,
  AVATAR_PRICES,
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
