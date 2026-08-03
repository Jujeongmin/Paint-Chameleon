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
import {
  MIN_PLAYERS as CLIENT_MIN_PLAYERS,
  MAX_PLAYERS as CLIENT_MAX_PLAYERS,
  POSES,
  MOVE,
  PAINT as CLIENT_PAINT,
  PHASE_SECONDS as CLIENT_PHASES,
  SHOT as CLIENT_SHOT,
} from "../game/src/game/constants";
import { CELL_SPAWN as CLIENT_CELL, HUNT_START as CLIENT_HUNT_START } from "../game/src/game/cell";
import {
  AD_REWARD as CLIENT_AD,
  AD_PANEL_MS,
  COINS as CLIENT_COINS,
  WALLET_FIELDS,
  coinsFor as clientCoinsFor,
} from "../game/src/game/coins";
import { claimAd as clientClaimAd, startAd as clientStartAd } from "../game/src/game/adRules";
import {
  ARENA as SERVER_ARENA,
  SPAWN_POINTS as SERVER_SPAWNS,
  CELL_SPAWN as SERVER_CELL,
  HUNT_START as SERVER_HUNT_START,
  POSE_COUNT as SERVER_POSE_COUNT,
  MOVE_SPEED_CAP,
  AVATAR_PRICES,
  AD_REWARD as SERVER_AD,
  DEFAULT_WALLET,
  claimAd as serverClaimAd,
  startAd as serverStartAd,
  SHOT as SERVER_SHOT,
  PAINT_LIMITS as SERVER_PAINT,
  PHASE_SECONDS as SERVER_PHASES,
  COINS as SERVER_COINS,
  coinsFor as serverCoinsFor,
  MIN_PLAYERS as SERVER_MIN_PLAYERS,
  MAX_PLAYERS as SERVER_MAX_PLAYERS,
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

console.log("\nroom size");

// The client shows the lobby's "{c}/{n}" and the server decides who actually
// gets in. Those were two copies of the same number with nothing comparing
// them — exactly the drift this file exists to stop, sitting in its own blind
// spot.
{
  if (CLIENT_MIN_PLAYERS === SERVER_MIN_PLAYERS) pass(`minimum players matches (${CLIENT_MIN_PLAYERS})`);
  else fail(`minimum players differs: ${CLIENT_MIN_PLAYERS} vs ${SERVER_MIN_PLAYERS}`);

  if (CLIENT_MAX_PLAYERS === SERVER_MAX_PLAYERS) pass(`maximum players matches (${CLIENT_MAX_PLAYERS})`);
  else fail(`maximum players differs: ${CLIENT_MAX_PLAYERS} vs ${SERVER_MAX_PLAYERS}`);

  // A room that can hold more people than it has places to put them would seat
  // the last arrivals inside the scenery.
  if (SERVER_SPAWNS.length >= SERVER_MAX_PLAYERS) {
    pass(`${SERVER_SPAWNS.length} spawn points for ${SERVER_MAX_PLAYERS} players`);
  } else {
    fail(`only ${SERVER_SPAWNS.length} spawn points for ${SERVER_MAX_PLAYERS} players`);
  }
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

console.log("\nphase durations");

// The server runs the clock; the client counts down its own copy on screen and
// decides what to draw in each phase. A drift shows as a countdown that hits
// zero while the phase carries on, or a phase that ends with time still on the
// display — and for the results phase, as the reveal of where the uncaught
// hiders were vanishing before or after the round actually returns to the hub.
{
  const clientKeys = Object.keys(CLIENT_PHASES).filter((k) => k !== "lobby").sort();
  const serverKeys = Object.keys(SERVER_PHASES).sort();

  if (clientKeys.join(",") !== serverKeys.join(",")) {
    fail(`phase keys differ: client [${clientKeys.join(", ")}], server [${serverKeys.join(", ")}]`);
  } else {
    const client = CLIENT_PHASES as Record<string, number>;
    const server = SERVER_PHASES as Record<string, number>;
    const mismatched = clientKeys.filter((k) => client[k] !== server[k]);
    if (mismatched.length) {
      for (const k of mismatched) {
        fail(`phase ${k} lasts ${client[k]}s on the client but ${server[k]}s on the server`);
      }
    } else {
      pass(`phase durations match (${clientKeys.map((k) => `${k} ${client[k]}s`).join(", ")})`);
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

console.log("\ncoins");

// The offline rehearsal rig pays itself for catching bots, and it cannot import
// the server's copy — server/src/rules.ts sits outside Vite's root. So the
// client mirrors it, and this comparison is what makes the mirror safe.
{
  const same =
    CLIENT_COINS.perRound === SERVER_COINS.perRound &&
    CLIENT_COINS.survived === SERVER_COINS.survived &&
    CLIENT_COINS.perCatch === SERVER_COINS.perCatch;
  if (same) pass(`coin values match (${JSON.stringify(CLIENT_COINS)})`);
  else fail(`coin values differ: ${JSON.stringify(CLIENT_COINS)} vs ${JSON.stringify(SERVER_COINS)}`);

  // Equal constants are not the same as equal answers — two functions can
  // combine the same numbers differently. Compare the payouts across the table.
  let drift = 0;
  for (const seeker of [true, false]) {
    for (const caught of [true, false]) {
      for (const catches of [0, 1, 3, 7, -2]) {
        const a = clientCoinsFor({ seeker, caught, catches });
        const b = serverCoinsFor({ seeker, caught, catches });
        if (a !== b) {
          drift++;
          if (drift === 1) {
            fail(`coinsFor disagrees at seeker=${seeker} caught=${caught} catches=${catches}: ${a} vs ${b}`);
          }
        }
      }
    }
  }
  if (drift === 0) pass("coinsFor agrees on both sides across the whole table");
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

console.log("\nads for coins");
{
  const keys = (Object.keys(DEFAULT_WALLET) as string[]).slice().sort();
  const mirrored = WALLET_FIELDS.slice().sort();
  // tsc already holds WALLET_FIELDS against the WalletView type (see coins.ts).
  // This is the other half: that type is the CLIENT's idea of a wallet, and
  // DEFAULT_WALLET is the server's. A field added on the server alone reaches
  // neither the type nor the list, so only this comparison would notice.
  if (JSON.stringify(keys) === JSON.stringify(mirrored)) {
    pass(`wallet has the same ${keys.length} fields on both sides`);
  } else {
    fail(`wallet fields differ: client ${JSON.stringify(mirrored)} vs server ${JSON.stringify(keys)}`);
  }

  const sameTerms = (Object.keys(SERVER_AD) as Array<keyof typeof SERVER_AD>).every(
    (k) => CLIENT_AD[k] === SERVER_AD[k]
  );
  if (sameTerms) pass(`ad terms match (${JSON.stringify(SERVER_AD)})`);
  else fail(`ad terms differ: ${JSON.stringify(CLIENT_AD)} vs ${JSON.stringify(SERVER_AD)}`);

  // The panel is client-only, but it decides when claimAd gets called, so it
  // has to clear the server's floor. Below it, every honest watch is refused.
  if (AD_PANEL_MS >= SERVER_AD.minWatchMs) {
    pass(`the panel runs ${AD_PANEL_MS}ms, at or above the server's ${SERVER_AD.minWatchMs}ms floor`);
  } else {
    fail(`the panel finishes at ${AD_PANEL_MS}ms but the server wants ${SERVER_AD.minWatchMs}ms`);
  }

  // Equal constants are not equal answers — same argument as coins above. The
  // rehearsal rig runs the client copy and real players hit the server copy, so
  // a difference in the REFUSALS is a difference in the only thing the rig is
  // there to rehearse.
  const NOON = Math.floor(1_700_000_000_000 / 86_400_000) * 86_400_000 + 43_200_000;
  const today = Math.floor(NOON / 86_400_000);
  const base = { ...DEFAULT_WALLET, owned: [...DEFAULT_WALLET.owned] };
  const wallets = [
    base,
    { ...base, adOpenedAt: NOON },
    { ...base, adOpenedAt: NOON, adClaimedAt: NOON },
    { ...base, adClaimedAt: NOON },
    { ...base, adDay: today, adCount: SERVER_AD.dailyCap },
    { ...base, adDay: today, adCount: SERVER_AD.dailyCap, adOpenedAt: NOON },
    { ...base, adOpenedAt: NOON + 5_000 },
    { ...base, coins: NaN, adOpenedAt: NOON },
  ];
  const clocks = [
    NOON,
    NOON + SERVER_AD.minWatchMs - 1,
    NOON + SERVER_AD.minWatchMs,
    NOON + SERVER_AD.cooldownMs,
    NOON + SERVER_AD.ticketMs + 1,
    NOON + 86_400_000,
  ];

  let drift = 0;
  for (const w of wallets) {
    for (const now of clocks) {
      const a = JSON.stringify(serverStartAd(w, now));
      const b = JSON.stringify(clientStartAd(w, now));
      if (a !== b) {
        drift++;
        fail(`startAd disagrees at +${now - NOON}ms: server ${a}, client ${b}`);
      }
      const c = JSON.stringify(serverClaimAd(w, now));
      const d = JSON.stringify(clientClaimAd(w, now));
      if (c !== d) {
        drift++;
        fail(`claimAd disagrees at +${now - NOON}ms: server ${c}, client ${d}`);
      }
    }
  }
  if (drift === 0) pass(`startAd and claimAd agree across ${wallets.length * clocks.length * 2} cases`);
}


if (failures === 0) {
  console.log("\n✅ client and server agree\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s) — src/game/map.ts and server/src/rules.ts have drifted\n`);
  process.exit(1);
}
