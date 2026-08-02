/**
 * The account's saved nickname — the seam, not the implementation.
 *
 * WHAT THIS IS FOR. Today the nick screen appears every single time the page
 * loads, because nothing anywhere remembers what you called yourself. The
 * server writes your nick into two places and neither is a profile: the room's
 * user state, which dies with the room, and the leaderboard collection, which
 * nobody reads back. So every reload asks again.
 *
 * WHAT IS DELIBERATELY MISSING. Storing it belongs on the server, keyed by the
 * Verse8 account, and that is being built in the Verse8 editor alongside the
 * rest of the server work. Guessing at it here would mean either inventing a
 * schema the real one has to match, or falling back to localStorage — which is
 * per-BROWSER, not per-account, and would look like it worked right up until
 * somebody opened the game on a second machine and was asked again. A stub that
 * is obviously a stub is better than a lie that mostly holds.
 *
 * So: the whole client path exists and is wired. `fetchSavedNick` returns null,
 * App reads it, and a non-null answer skips the nick screen. Filling this in is
 * a one-function change with no UI work behind it.
 *
 * WHAT THE REAL ONE HAS TO DO
 *
 *   1. Server: a `getProfile` remote function returning `{ nick }` for
 *      `$sender.account`, reading the same collection the wallet uses (see
 *      `readWallet` in server/src/server.ts — WalletState is the obvious place
 *      to hang a `nick` field, and it is already read on join).
 *   2. Server: persist the nick on `joinHub`, which already receives it and
 *      already sanitises it (`sanitizeNick`).
 *   3. Here: call it and return the nick, or null when the account has never
 *      set one.
 *   4. Somewhere in the hub: a way to CHANGE it, since the nick screen will no
 *      longer be shown to anyone who has one. That is the piece most easily
 *      forgotten, and without it a typo is permanent.
 *
 * check:sync is the thing that will need updating if `nick` joins WalletState:
 * the wallet's shape is mirrored across the client/server boundary.
 */

/**
 * The server handle useGame carries. Typed loosely on purpose: the real
 * implementation will call one remote function on it and nothing here should
 * pretend to know more about it than that.
 */
type Server = { remoteFunction: (fn: string, args?: unknown[]) => Promise<unknown> };

export interface SavedProfile {
  nick: string;
}

/**
 * The saved nick for the signed-in account, or null if there is not one.
 *
 * Never throws: a profile lookup failing must not stop somebody playing, so a
 * broken or missing implementation falls through to the nick screen — which is
 * exactly today's behaviour, and is why returning null unconditionally is a
 * safe stub rather than a broken state.
 */
export async function fetchSavedNick(_server: Server): Promise<string | null> {
  // Not implemented — see the note above. The call site is real; this is not.
  return null;
}

/**
 * Remember the nick against the account. Currently a no-op.
 *
 * Called on join so that the day the server side lands, the write path is
 * already being exercised from the right place rather than needing to be found.
 */
export async function saveNick(_server: Server, _nick: string): Promise<void> {
  // Not implemented — see the note above.
}
