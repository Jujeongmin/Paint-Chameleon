/**
 * The ad-reward decisions, mirrored from `server/src/rules.ts`.
 *
 * Same gap and same reason as `coins.ts`: the server's copy lives outside
 * Vite's root and cannot be imported. What is different here is that the client
 * genuinely runs these — the offline rehearsal rig has no server, and its whole
 * value is that the refusals behave the way the real ones do. A rig that says
 * "sure, here are your coins" where the server would say "cooldown" rehearses
 * nothing.
 *
 * The live client does NOT decide anything with these. It asks the server and
 * renders the answer. These are for the rig, plus the cooldown clock and the
 * "N left today" counter, which are display.
 *
 * KEEP IN SYNC WITH server/src/rules.ts. `check:sync` does not merely compare
 * the constants — it runs both copies over the same scenarios and compares the
 * answers, which is the only comparison that would have caught a mirror whose
 * numbers matched and whose logic did not.
 */
import type { WalletView } from "../net/types";
import { AD_REWARD } from "./coins";

export type AdFailure =
  | "cooldown"
  | "cap"
  | "tooSoon"
  | "noAd"
  | "stale"
  | "noRequest"
  | "replay"
  | "unverified";

/**
 * Mirrors AdTicket in server/src/rules.ts — see there for why `verified` has
 * three values rather than two.
 */
export interface AdTicket {
  requestId: string;
  verified: boolean | null;
}

export function dayIndex(now: number): number {
  return Math.floor(now / 86_400_000);
}

export function adsToday(w: WalletView, now: number): number {
  return dayIndex(now) === w.adDay ? Math.max(0, Math.floor(w.adCount) || 0) : 0;
}

export function adsLeft(w: WalletView, now: number): number {
  return Math.max(0, AD_REWARD.dailyCap - adsToday(w, now));
}

export function adReadyAt(w: WalletView, now: number): number {
  void now;
  return (Number.isFinite(w.adClaimedAt) ? w.adClaimedAt : 0) + AD_REWARD.cooldownMs;
}

export function startAd(
  w: WalletView,
  now: number
): { ok: true; wallet: WalletView } | { ok: false; reason: AdFailure } {
  if (adsLeft(w, now) <= 0) return { ok: false, reason: "cap" };
  if (now < adReadyAt(w, now)) return { ok: false, reason: "cooldown" };
  return { ok: true, wallet: { ...w, owned: [...w.owned], adOpenedAt: now } };
}

export function claimAd(
  w: WalletView,
  now: number,
  ticket: AdTicket
):
  | { ok: true; wallet: WalletView; coins: number }
  | { ok: false; reason: AdFailure; wallet?: WalletView } {
  const opened = Number.isFinite(w.adOpenedAt) ? w.adOpenedAt : 0;
  if (opened <= 0) return { ok: false, reason: "noAd" };

  const requestId = typeof ticket.requestId === "string" ? ticket.requestId.trim() : "";
  if (!requestId || requestId.includes(",")) {
    return { ok: false, reason: "noRequest", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  const spent = Array.isArray(w.adRequests) ? w.adRequests : [];
  if (spent.includes(requestId)) {
    return { ok: false, reason: "replay", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  if (ticket.verified === false) {
    return { ok: false, reason: "unverified", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  const watched = now - opened;
  if (watched > AD_REWARD.ticketMs || watched < 0) {
    return { ok: false, reason: "stale", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }
  if (watched < AD_REWARD.minWatchMs) return { ok: false, reason: "tooSoon" };

  if (adsLeft(w, now) <= 0) {
    return { ok: false, reason: "cap", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }
  if (now < adReadyAt(w, now)) {
    return { ok: false, reason: "cooldown", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  const today = dayIndex(now);
  return {
    ok: true,
    coins: AD_REWARD.coins,
    wallet: {
      ...w,
      owned: [...w.owned],
      coins: (Number.isFinite(w.coins) ? w.coins : 0) + AD_REWARD.coins,
      adOpenedAt: 0,
      adClaimedAt: now,
      adDay: today,
      adCount: adsToday(w, now) + 1,
      adRequests: [requestId, ...spent].slice(0, AD_REWARD.recentRequests),
    },
  };
}
