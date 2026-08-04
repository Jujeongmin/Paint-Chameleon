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
  /**
   * The SDK's id for this watch. The server needs it to verify the watch and
   * to refuse the same one twice, so a completed outcome without one is not
   * claimable — see claimAd in server/src/rules.ts.
   */
  requestId: string;
  /**
   * The ads guide's `unsupported_env`: this page can never play an ad, so the
   * button should go away for the session rather than fail quietly on every
   * press.
   */
  unsupported?: boolean;
  /**
   * A failure worth telling the player about. `busy` is excluded on purpose —
   * the guide says ignore it, and the caller already prevents concurrent
   * watches, so hearing about it would only ever be noise.
   */
  failed?: boolean;
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
  if (OFFLINE) return { completed: false, requestId: "", unsupported: true };
  try {
    const result = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENT_ID });
    const requestId = result.requestId ?? "";
    if (signal.aborted) return { completed: false, requestId };

    if (result.status === "rewarded") return { completed: true, requestId };
    // Dismissed is silent: the player closed it themselves and knows why.
    if (result.status === "dismissed") return { completed: false, requestId };

    const code = result.error?.code;
    return {
      completed: false,
      requestId,
      unsupported: code === "unsupported_env",
      // Everything but busy is worth a word. `busy` cannot normally reach here
      // — useWallet refuses a second watch while one is running — so if it
      // does, the honest response is still to say nothing and let the running
      // ad finish.
      failed: code !== "busy" && code !== "unsupported_env",
    };
  } catch {
    // showRewarded is documented never to reject; if it does, that is a broken
    // SDK rather than a player action, and the button should stay usable.
    return { completed: false, requestId: "", failed: true };
  }
}
