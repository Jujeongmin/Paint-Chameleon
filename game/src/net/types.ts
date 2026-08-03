import type { Phase } from "../game/constants";
import type { GameMode } from "../game/modes";
import type { PaintDab } from "../game/paint";

export interface PlayerState {
  account: string;
  nick?: string;
  ready?: boolean;
  role?: "hider" | "seeker";
  caught?: boolean;
  caughtAt?: number | null;
  pos?: number[];
  rotY?: number;
  pose?: number;
  moving?: boolean;
  /** Equipped body profile id; unknown values fall back to the default. */
  body?: string;
  /**
   * Out of the round and watching: hunt mode only, and only after being caught.
   * Nobody draws a body for a spectator — that is the mode's whole promise.
   */
  spectating?: boolean;
  /** When a caught hider changed sides. Tag mode only; null otherwise. */
  convertedAt?: number | null;
  /** Translation key for an AI hider's display name. */
  nameKey?: string;
  bot?: boolean;
}

export interface RoomInfo {
  /** Hub rooms are social space; game rooms run rounds. */
  kind: "hub" | "game";
  /** Which of the two rooms this is. See game/src/game/modes.ts. */
  mode: GameMode;
  phase: Phase;
  phaseEndsAt: number;
  tickAt: number;
  round: number;
  seeker: string | null;
  scores: Record<string, number>;
  lastResults: any[] | null;
  bots?: PlayerState[];
  /**
   * How many players this room needs before a round can start. The online
   * and offline implementations disagree on this — the live server enforces
   * `MIN_PLAYERS` (2), while the offline rehearsal rig runs solo and only
   * ever has 1 — so each reports its own number here rather than callers
   * importing a single constant that would be wrong for one of the two.
   */
  minPlayers: number;
}

/** A dab as it travels over the wire: `j` continues the previous stroke. */
export interface WireDab extends PaintDab {
  j?: boolean;
}

export interface RankedLeaderboardEntry {
  account: string;
  nick: string;
  total: number;
  rank: number;
}

export interface LeaderboardResult {
  top: RankedLeaderboardEntry[];
  me: RankedLeaderboardEntry | null;
}

export interface WalletView {
  coins: number;
  owned: string[];
  equipped: string;
  /**
   * Ad bookkeeping, as the server keeps it. The client reads these to draw the
   * remaining count and the cooldown and does nothing else with them — every
   * one is a server clock reading, and re-deriving a decision from them here
   * would be re-deciding something the server already decided.
   */
  adOpenedAt: number;
  adClaimedAt: number;
  adDay: number;
  adCount: number;
}

export type BuyFailure = "unknown" | "owned" | "broke";

export type BuyResult =
  | { ok: true; wallet: WalletView }
  | { ok: false; reason: BuyFailure };

export type AdFailure = "cooldown" | "cap" | "tooSoon" | "noAd" | "stale";

/** A refusal still carries a wallet — the server may have cleared a stale ad. */
export type AdStartResult =
  | { ok: true; wallet: WalletView }
  | { ok: false; reason: AdFailure; wallet: WalletView };

export type AdClaimResult =
  | { ok: true; wallet: WalletView; coins: number }
  | { ok: false; reason: AdFailure; wallet: WalletView };
