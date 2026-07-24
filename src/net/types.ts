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
}

/** A dab as it travels over the wire: `j` continues the previous stroke. */
export interface WireDab extends PaintDab {
  j?: boolean;
}
