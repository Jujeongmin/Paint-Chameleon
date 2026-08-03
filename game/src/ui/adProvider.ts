/**
 * Where the real ad goes.
 *
 * `showAd` is what the shop calls. In a deployed Verse8 build it hands the
 * watch to @verse8/ads and maps the result onto the same `{ completed }`
 * contract the server's reward rules expect. There is no in-app fallback panel
 * any more — a page that cannot play a real ad (offline rehearsal, a plain
 * browser) simply resolves `{ completed: false }` and the server refuses the
 * claim with "try again".
 *
 * The server never learns which provider it was, on purpose: it measures
 * elapsed time on its own clock (see `claimAd` in server/src/rules.ts), so a
 * provider change cannot weaken it.
 *
 * The contract any provider has to keep:
 *
 * - Resolve `{ completed: true }` only when the ad was watched to the end.
 *   Resolving early costs nothing — the server refuses the claim with
 *   "tooSoon" — but it puts a refusal in front of a player who did nothing
 *   wrong, which is worse than not offering the ad.
 * - Resolve `{ completed: false }` on skip, close, block or no-fill. Never
 *   reject: a rejected promise here reads to the caller as a bug in the game,
 *   and "no ad available right now" is an ordinary Tuesday for ad networks.
 * - Return control to the page. Pointer lock is already released by the shop
 *   before this is called.
 */
import { Verse8Ads } from "@verse8/ads";

export interface AdOutcome {
  completed: boolean;
}

/** Ad placement registered for the shop's coin reward. */
const AD_PLACEMENT_ID = "shop-coins";

/**
 * True when running a deployed build rather than the local rehearsal rig.
 * Mirrors useGame.ts's OFFLINE switch: the real ad can only play inside a
 * Verse8 host, and `showRewarded` in a hostless page can hang for its full
 * 30s timeout instead of failing fast, so offline mode never calls it.
 */
const OFFLINE = !import.meta.env.VITE_AGENT8_VERSE;

/**
 * Plays a rewarded ad. `showRewarded` never rejects — every outcome is a
 * status, so `rewarded` is the only one worth coins; dismissed, busy, timeout
 * and platform errors all come back as `completed: false`.
 */
export async function showAd(signal: AbortSignal): Promise<AdOutcome> {
  if (OFFLINE) return { completed: false };
  try {
    const result = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENT_ID });
    if (signal.aborted) return { completed: false };
    return { completed: result.status === "rewarded" };
  } catch {
    return { completed: false };
  }
}
