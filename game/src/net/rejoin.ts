/**
 * When the client may put itself back into a room, and how long it waits first.
 *
 * Pulled out of useGame so the rule can be read and checked without a socket:
 * `npm run check:rejoin` states the cases, and the header of that script keeps
 * the measurement the two clocks below are derived from.
 */

/**
 * A broken socket response must return control to the join button — but a join
 * that is merely slow must not be called broken.
 *
 * A room switch measured about eighteen seconds against the live verse, so the
 * old twelve reported a failure for a call that was still working: the player
 * got an error, then the room they had asked for, in that order.
 */
export const REMOTE_CALL_TIMEOUT_MS = 45_000;

/** Room subscriptions can fail independently after the join RPC succeeds. */
export const ROOM_STATE_TIMEOUT_MS = 45_000;

/**
 * How long the room may be missing AFTER we have been in one before the client
 * treats it as lost rather than as a gap.
 *
 * Both things happen. The server replaces the room state between rounds, which
 * blinks for a tick or two and is not a problem. A dropped socket also empties
 * it — the SDK reconnects on its own (useGameServer re-runs connect whenever
 * `connected` goes false) and re-subscribes, but nobody re-joins the ROOM,
 * because only this client knows which room it wanted to be in.
 *
 * This is a floor, not the whole guard. The third way to empty the room state
 * is for the player to ask for a different room, and no length of wait can
 * separate that from a dropped socket — see `shouldReplayJoin`.
 */
export const ROOM_LOST_GRACE_MS = 5_000;

export interface RejoinInputs {
  /** The SDK's socket. A pending call on a dead socket will never answer. */
  connected: boolean;
  /** Room state and our own user state are both in hand. */
  roomReady: boolean;
  /** This session has held a room at some point. */
  hasReceivedRoom: boolean;
  /** A join we issued has not settled yet — including one already timed out. */
  changeInFlight: boolean;
}

/**
 * Whether the recovery timer should replay the last join.
 *
 * The interesting case is the third. Entering a match empties the room state
 * for as long as the switch takes, which is much longer than the grace above;
 * without this the timer read a perfectly healthy join as a dropped connection,
 * fired a second join into matchmaking, and landed the player in a different
 * room — which emptied the room state again, which fired another. That is the
 * "it keeps finding another room" the player sees.
 */
export function shouldReplayJoin({
  connected,
  roomReady,
  hasReceivedRoom,
  changeInFlight,
}: RejoinInputs): boolean {
  if (roomReady) return false;
  // Never had a room: the join RPC answered but its subscriptions never did.
  // That is the join timeout's case, and it ends at the nick screen.
  if (!hasReceivedRoom) return false;
  // Our own room change, still landing. `connected` qualifies it because a call
  // pending on a socket that has since died will never settle, and waiting on
  // it forever would disable the very recovery this exists for.
  if (changeInFlight && connected) return false;
  return true;
}
