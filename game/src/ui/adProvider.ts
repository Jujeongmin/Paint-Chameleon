/**
 * Where the real ad goes.
 *
 * In a deployed Verse8 build `showAd` hands the watch to @verse8/ads and maps
 * the result onto the same `{ completed }` contract the server's reward rules
 * expect. Where no ad host exists — offline rehearsal, a plain browser — it
 * falls back to the in-app countdown panel so the rig still rehearses the
 * whole flow. Either way the server never learns which provider it was, on
 * purpose: it measures elapsed time on its own clock (see `claimAd` in
 * server/src/rules.ts), so a provider change cannot weaken it.
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
import { AD_PANEL_MS } from "../game/coins";

export interface AdOutcome {
  completed: boolean;
}

/** Progress of the fallback ad, 0..1. Null when no ad is on screen. */
export type AdProgress = ((p: number) => void) | null;

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
 * A frame gap longer than this is not time the player spent watching.
 *
 * requestAnimationFrame stops entirely in a hidden tab and resumes on return,
 * so the first frame back reports the whole absence as one delta. Counting it
 * would make "watch an ad" mean "open an ad and switch tabs for fifteen
 * seconds", which is the one thing the countdown exists to prevent. Clamping
 * the delta also covers ordinary hitches — a long GC pause is not watching
 * either, and the cost of being wrong is a fraction of a second.
 */
const MAX_FRAME_MS = 100;

/**
 * Plays a real rewarded ad when a Verse8 host is present.
 *
 * `showRewarded` never rejects — every outcome is a status. `rewarded` is the
 * only one worth coins; dismissed, busy, timeout and platform errors all come
 * back as `completed: false`. An `unsupported_env` result means this page is
 * not running inside an ad-capable host after all, so we fall back to the
 * in-app countdown rather than refusing the player.
 */
async function runRealAd(
  onProgress: (p: number) => void,
  signal: AbortSignal
): Promise<AdOutcome> {
  const result = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENT_ID });
  if (signal.aborted) return { completed: false };
  if (result.status === "rewarded") return { completed: true };
  if (result.status === "failed" && result.error?.code === "unsupported_env") {
    return runPlaceholderAd(onProgress, signal);
  }
  return { completed: false };
}

/**
 * Runs the fallback ad. Resolves completed:true unless `signal` aborts first.
 *
 * Counts time the panel was actually on screen, not wall-clock time since the
 * start. Those differ by however long the tab was hidden, and only one of them
 * is the thing being asked for.
 *
 * This can only ever run LONGER than wall clock, never shorter, so it cannot
 * put the player in front of a finished bar and a server that says "tooSoon" —
 * the server measures the same window on its own clock and its floor is lower.
 */
function runPlaceholderAd(
  onProgress: (p: number) => void,
  signal: AbortSignal
): Promise<AdOutcome> {
  return new Promise<AdOutcome>((resolve) => {
    let watched = 0;
    let last = Date.now();
    let frame = 0;

    const stop = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      stop();
      resolve({ completed: false });
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort);

    const step = () => {
      const now = Date.now();
      watched += Math.min(now - last, MAX_FRAME_MS);
      last = now;

      const p = Math.min(1, watched / AD_PANEL_MS);
      onProgress(p);
      if (p >= 1) {
        stop();
        resolve({ completed: true });
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  });
}

/**
 * The seam. In a deployed build a real rewarded ad plays; offline rehearsal
 * skips the SDK entirely and uses the countdown panel (the SDK has no host to
 * talk to there, and would time out rather than fail fast).
 */
export function showAd(onProgress: (p: number) => void, signal: AbortSignal): Promise<AdOutcome> {
  return (OFFLINE ? runPlaceholderAd(onProgress, signal) : runRealAd(onProgress, signal)).catch(() =>
    runPlaceholderAd(onProgress, signal)
  );
}
