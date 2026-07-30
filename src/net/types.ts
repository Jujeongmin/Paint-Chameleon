import type { Phase } from "../game/constants";
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
}

export interface RoomInfo {
  /** Hub rooms are social space; game rooms run rounds. */
  kind: "hub" | "game";
  phase: Phase;
  phaseEndsAt: number;
  tickAt: number;
  round: number;
  seeker: string | null;
  scores: Record<string, number>;
  lastResults: any[] | null;
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
}

export type BuyFailure = "unknown" | "owned" | "broke";

export type BuyResult =
  | { ok: true; wallet: WalletView }
  | { ok: false; reason: BuyFailure };
