/**
 * The seam where a real ad goes.
 *
 * There is no ad network wired into this build. `showAd` is what the shop
 * calls, and today it resolves after `AD_PANEL_MS` while <AdBreak/> draws a
 * countdown. Swapping in a real one means replacing this function and nothing
 * else — the server's reward rules never learn which it was, on purpose. They
 * measure elapsed time on their own clock either way (see `claimAd` in
 * server/src/rules.ts), so a provider change cannot weaken them.
 *
 * The contract a real provider has to keep:
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
import { AD_PANEL_MS } from "../game/coins";

export interface AdOutcome {
  completed: boolean;
}

/** Progress of the placeholder ad, 0..1. Null when no ad is on screen. */
export type AdProgress = ((p: number) => void) | null;

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
 * Runs the placeholder ad. Resolves completed:true unless `signal` aborts first.
 *
 * Counts time the panel was actually on screen, not wall-clock time since the
 * start. Those differ by however long the tab was hidden, and only one of them
 * is the thing being asked for.
 *
 * This can only ever run LONGER than wall clock, never shorter, so it cannot
 * put the player in front of a finished bar and a server that says "tooSoon" —
 * the server measures the same window on its own clock and its floor is lower.
 */
export function showAd(onProgress: (p: number) => void, signal: AbortSignal): Promise<AdOutcome> {
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
