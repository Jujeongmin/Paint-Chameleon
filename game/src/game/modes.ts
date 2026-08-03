/**
 * The two rooms, mirrored from the server.
 *
 * Same reason as coins.ts: `server/src/rules.ts` is outside Vite's root and
 * cannot be imported, and a mirror is only allowed here when something compares
 * it. check:sync compares both the table and the answers the functions give.
 *
 * KEEP IN SYNC WITH server/src/rules.ts.
 */

import type { Key } from "../ui/i18n";

export type GameMode = "tag" | "hunt";

/**
 * What each door is called, as i18n keys rather than words.
 *
 * The words themselves are in i18n.ts, because the room a player is in should
 * be named in the language they chose. Keeping keys here means the mapping
 * from mode to name stays next to the mode, and check:modes can assert that
 * every mode has a name in every language.
 */
export const MODE_TEXT: Record<GameMode, { labelKey: Key; subKey: Key }> = {
  /**
   * Being caught puts you on the other side: you get up as a seeker and help
   * hunt whoever is left, so the hunt accelerates with every catch.
   */
  tag: { labelKey: "mode.tag.label", subKey: "mode.tag.sub" },
  /**
   * Being caught ends your round. The body is removed rather than left lying
   * about, and you watch the rest from a free camera.
   */
  hunt: { labelKey: "mode.hunt.label", subKey: "mode.hunt.sub" },
};

export const DEFAULT_MODE: GameMode = "tag";

export function isGameMode(v: unknown): v is GameMode {
  return v === "tag" || v === "hunt";
}

export function modeOf(v: unknown): GameMode {
  return isGameMode(v) ? v : DEFAULT_MODE;
}

/**
 * Whether being caught takes you out of the game entirely.
 *
 * The client asks this in three places — whether to draw a body, whether to
 * hand the camera over to free flight, and whether the leave button is live —
 * and all three have to agree, so none of them tests the mode string directly.
 */
export function caughtIsOut(mode: GameMode): boolean {
  return mode === "hunt";
}

/**
 * Whether the round itself pins you where you are.
 *
 * Only the results phase does, and only to hiders. The seeker walks: the whole
 * reason that phase is thirty seconds long is that the hiders who were never
 * found glow through the walls, and "go and look at where they were" is not
 * something you can do standing still.
 *
 * Hiders stay pinned for the same reason, from the other side. A revealed hider
 * who wanders off is a glow that no longer marks the hiding place — the thing
 * the reveal exists to show would walk away while the seeker was on their way
 * over to see it.
 *
 * This is only the ROUND's opinion. App.tsx also freezes for the paint panel,
 * the pose menu and being caught, which are about what the player is doing
 * rather than about what phase it is.
 */
export function roundFreezes(phase: string, isSeeker: boolean): boolean {
  return phase === "results" && !isSeeker;
}

export interface PoseGate {
  /** In the social hub rather than a match. */
  inHub: boolean;
  isSeeker: boolean;
  phase: string;
  caught: boolean;
}

/**
 * Whether a player may change pose or repaint right now.
 *
 * Open for the whole round up to the results, seeking included. It used to stop
 * the moment the seeker was let out, which made the disguise something you
 * committed to in the first thirty seconds and then could only watch fail. Being
 * able to re-pose when you hear footsteps, or match a colour you only noticed
 * once you were pressed against it, is the game the paint is for.
 *
 * The costs are real and are the point: painting freezes you and puts a panel
 * over the screen (App's `frozen`), so you are choosing to stop looking around
 * in exchange for a better disguise, in the phase where someone is hunting you.
 *
 * Not the seeker — the disguise is a hider's tool, and the seeker's stint in
 * the holding cell is handled separately (App's `canPaint` adds `inCell`).
 * Not the results phase, where hiders are pinned so the reveal keeps marking
 * where they actually hid. Not while caught.
 */
export function canPoseNow({ inHub, isSeeker, phase, caught }: PoseGate): boolean {
  if (inHub || isSeeker || caught) return false;
  return phase !== "results";
}

/**
 * When leaving is offered.
 *
 * Always once the round is over, which is the promise the results screen makes.
 * And immediately for somebody whose round has ended early because they were
 * caught in a mode where that is final — making them sit and watch until the
 * clock runs out would be a punishment nobody asked for.
 */
export function canLeaveNow(mode: GameMode, phase: string, caught: boolean): boolean {
  if (phase === "results") return true;
  return caughtIsOut(mode) && caught;
}
