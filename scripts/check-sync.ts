/**
 * Guards the one unavoidable duplication in this project.
 *
 * The server runs in an isolated VM and cannot import from src/, so the map
 * generator exists twice. If the two drift, players walk around one arena while
 * the server spawns them into another — a silent bug that no type check or unit
 * test on either side alone would catch.
 *
 * Run: npm run check:sync
 */

import { MAP_BOXES as CLIENT_BOXES, ARENA as CLIENT_ARENA } from "../src/game/map";
import { POSES, MOVE } from "../src/game/constants";
import {
  MAP_BOXES as SERVER_BOXES,
  ARENA as SERVER_ARENA,
  POSE_COUNT as SERVER_POSE_COUNT,
  MOVE_SPEED_CAP,
  isOpen,
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

console.log("\nmap geometry");

if (CLIENT_BOXES.length !== SERVER_BOXES.length) {
  fail(`box count differs: client ${CLIENT_BOXES.length}, server ${SERVER_BOXES.length}`);
} else {
  pass(`${CLIENT_BOXES.length} boxes on both sides`);

  let mismatched = 0;
  for (let i = 0; i < CLIENT_BOXES.length; i++) {
    const a = CLIENT_BOXES[i];
    const b = SERVER_BOXES[i];
    const same =
      a.c === b.c &&
      a.p.every((v, j) => Math.abs(v - b.p[j]) < 1e-9) &&
      a.s.every((v, j) => Math.abs(v - b.s[j]) < 1e-9);
    if (!same) {
      if (mismatched < 3) {
        fail(`box ${i} differs\n      client ${JSON.stringify(a)}\n      server ${JSON.stringify(b)}`);
      }
      mismatched++;
    }
  }
  if (mismatched === 0) pass("every box matches position, size and colour");
  else fail(`${mismatched} boxes differ in total`);
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

console.log("\nspawn safety");

// The server picks spawn points; if its clearance test disagrees with the
// client's geometry, players materialise inside crates.
let blocked = 0;
const SAMPLES = 300;
for (let i = 0; i < SAMPLES; i++) {
  const limit = SERVER_ARENA.size / 2 - 2.5;
  const x = (Math.random() * 2 - 1) * limit;
  const z = (Math.random() * 2 - 1) * limit;
  if (!isOpen(x, z)) continue;

  // Anything the server calls open must also be clear of every client box.
  const overlapping = CLIENT_BOXES.some(
    (b) =>
      b.p[1] + b.s[1] / 2 > 1.15 &&
      Math.abs(x - b.p[0]) < b.s[0] / 2 + 0.45 &&
      Math.abs(z - b.p[2]) < b.s[2] / 2 + 0.45
  );
  if (overlapping) blocked++;
}

if (blocked > 0) fail(`${blocked} server-approved spawn points land inside client geometry`);
else pass(`server spawn clearance agrees with client collision (${SAMPLES} samples)`);

if (failures === 0) {
  console.log("\n✅ client and server agree\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s) — src/game/map.ts and server/src/rules.ts have drifted\n`);
  process.exit(1);
}
