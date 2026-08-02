import type { WalletView } from "../net/types";

/**
 * What a round pays out, mirrored from the server.
 *
 * The client had no copy of this until the offline rig needed to pay itself for
 * catching bots, and it cannot simply import the real one: `server/src/rules.ts`
 * lives outside Vite's root (`game/`), which refuses to serve above itself.
 *
 * So it is a mirror, and mirrors in this project are only allowed on one
 * condition — that something compares them. `check:sync` does, the same way it
 * already holds ARENA, SPAWN_POINTS and SHOT together across the same gap. If
 * the server changes what a catch is worth and this does not, the check goes
 * red rather than the rehearsal quietly paying the wrong amount.
 *
 * KEEP IN SYNC WITH server/src/rules.ts.
 */

export const COINS = { perRound: 5, survived: 5, perCatch: 2 };

/** Pure, and identical to the server's. See the note above about the mirror. */
export function coinsFor(o: { seeker: boolean; caught: boolean; catches: number }): number {
  const catches = Math.max(0, Math.floor(o.catches || 0));
  if (o.seeker) return COINS.perRound + catches * COINS.perCatch;
  return COINS.perRound + (o.caught ? 0 : COINS.survived);
}

/**
 * Ad reward terms, mirrored from server/src/rules.ts for the same reason COINS
 * is: the shop has to draw "3 left today" and a cooldown clock before the
 * server has been asked anything, and it cannot import across Vite's root.
 *
 * Only the display reads these. Nothing here decides whether a reward is owed —
 * that is `claimAd` on the server, and it re-checks every one of these itself.
 * If this mirror drifts the worst case is a wrong number on screen, and
 * check:sync is what stops even that.
 *
 * KEEP IN SYNC WITH server/src/rules.ts.
 */
export const AD_REWARD = {
  coins: 25,
  minWatchMs: 14_000,
  cooldownMs: 90_000,
  dailyCap: 10,
  ticketMs: 300_000,
};

/**
 * How long the panel actually counts down for.
 *
 * Client-only — the server has `minWatchMs` and does not care what this is. It
 * sits above minWatchMs so an honest watch always clears the server's bar even
 * when the start call took a moment to land.
 */
export const AD_PANEL_MS = 15_000;

/**
 * The wallet's field names, as a value.
 *
 * WalletView is a type, and a type cannot be compared to the server's object at
 * runtime — which is precisely the gap this project keeps falling into
 * (MAX_PLAYERS sat mirrored and uncompared for months). This list closes it in
 * two hops: tsc holds the list against WalletView below, and check:sync holds
 * the list against the server's DEFAULT_WALLET. Add a field on one side only
 * and one of the two goes red.
 */
export const WALLET_FIELDS = [
  "coins",
  "owned",
  "equipped",
  "adOpenedAt",
  "adClaimedAt",
  "adDay",
  "adCount",
] as const;

// Both directions, or a field could be missing from one side and go unnoticed.
// These resolve to `true` when the sets match and to `never` when they don't,
// and a const of type never has no value that can be assigned to it.
type Missing = Exclude<keyof WalletView, (typeof WALLET_FIELDS)[number]>;
type Extra = Exclude<(typeof WALLET_FIELDS)[number], keyof WalletView>;
const _walletFieldsCoverWalletView: [Missing, Extra] extends [never, never] ? true : never = true;
void _walletFieldsCoverWalletView;
