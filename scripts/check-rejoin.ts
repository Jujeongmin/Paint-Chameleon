/**
 * When the client is allowed to re-join a room by itself.
 *
 * This is the narrowest possible seam and it earns a script of its own because
 * getting it wrong is not a cosmetic fault — it moves the player. The recovery
 * timer exists for a room that went away under a live session, but a room the
 * player themself asked to change also goes away, and for as long as the switch
 * takes the two look identical from the client's side. Judged wrongly, the timer
 * fires a second join on top of the first, matchmaking picks whatever lobby is
 * open, and the player is dragged out of the room they were waiting in.
 *
 * The measurement behind the numbers, taken against the live verse on
 * 2026-08-04 (dev build, one player, no other traffic):
 *
 *     __rooms / getWallet / getLeaderboard    0.07 - 0.5s
 *     joinHub while in no room                0.3s
 *     joinRoom while already in a room       17.4 / 17.5 / 17.9 / 18.9s
 *
 * Switching rooms costs about eighteen seconds and the client's room state is
 * empty for all of it. Both of the old constants sat below that: the call
 * timeout at 12s reported a failure for a join that was still working, and the
 * five second grace armed the recovery timer three times over.
 *
 * Run: npm run check:rejoin
 */

import {
  REMOTE_CALL_TIMEOUT_MS,
  ROOM_LOST_GRACE_MS,
  shouldReplayJoin,
  type RejoinInputs,
} from "../game/src/net/rejoin";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

/** The state of a session that has lost its room and nothing else. */
const lost: RejoinInputs = {
  connected: true,
  roomReady: false,
  hasReceivedRoom: true,
  changeInFlight: false,
};

/** Longest room switch seen against the live verse. See the header. */
const MEASURED_SWITCH_MS = 18_868;

console.log("\nrejoin\n");

console.log("what the timer may do");
{
  check("a lost room is re-joined", shouldReplayJoin(lost));
  check("a room in hand is left alone", !shouldReplayJoin({ ...lost, roomReady: true }));
  check(
    "a session that never had a room is not recovered, it is failed",
    !shouldReplayJoin({ ...lost, hasReceivedRoom: false }),
    "that case belongs to the join timeout, which returns to the nick screen"
  );
}

console.log("\nthe player's own room change");
{
  check(
    "a switch we asked for is not mistaken for a lost room",
    !shouldReplayJoin({ ...lost, changeInFlight: true }),
    "this is the whole bug: an 18s join emptied the room state, the timer read " +
      "that as a dropped connection at 5s, and re-joined on top of the join"
  );
  check(
    "a dead socket does not let an in-flight call block recovery forever",
    shouldReplayJoin({ ...lost, changeInFlight: true, connected: false }),
    "an RPC pending on a socket that is gone will never settle, so it cannot " +
      "be the reason to keep waiting"
  );
}

console.log("\nthe two clocks against the measurement");
{
  check(
    `the call timeout (${REMOTE_CALL_TIMEOUT_MS}ms) outlasts a real room switch (${MEASURED_SWITCH_MS}ms)`,
    REMOTE_CALL_TIMEOUT_MS > MEASURED_SWITCH_MS,
    "below this a normal join reports an error to a player it is about to serve"
  );
  check(
    "the timeout keeps headroom over the measurement rather than hugging it",
    REMOTE_CALL_TIMEOUT_MS >= MEASURED_SWITCH_MS * 1.5,
    "the figure is one verse on one day; a switch is allowed to be slower than " +
      "the slowest one seen"
  );
  check(
    "a player is not left reading a loading screen indefinitely",
    REMOTE_CALL_TIMEOUT_MS <= 60_000
  );
  check(
    `the grace (${ROOM_LOST_GRACE_MS}ms) still reacts inside the call timeout`,
    ROOM_LOST_GRACE_MS < REMOTE_CALL_TIMEOUT_MS,
    "the grace is now a floor, not the guard — changeInFlight is the guard"
  );
  check(
    "the grace outlasts a round transition's blink",
    ROOM_LOST_GRACE_MS >= 3_000
  );
}

if (failures === 0) {
  console.log("\n✅ the client re-joins only a room it actually lost\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
