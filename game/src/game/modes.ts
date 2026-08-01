/**
 * The two rooms, mirrored from the server.
 *
 * Same reason as coins.ts: `server/src/rules.ts` is outside Vite's root and
 * cannot be imported, and a mirror is only allowed here when something compares
 * it. check:sync compares both the table and the answers the functions give.
 *
 * KEEP IN SYNC WITH server/src/rules.ts.
 */

export type GameMode = "tag" | "hunt";

export const GAME_MODES: Record<GameMode, { label: string; sub: string }> = {
  /**
   * Being caught puts you on the other side: you get up as a seeker and help
   * hunt whoever is left, so the hunt accelerates with every catch.
   */
  tag: { label: "PAINT CHAMELEON", sub: "술래 늘리기" },
  /**
   * Being caught ends your round. The body is removed rather than left lying
   * about, and you watch the rest from a free camera.
   */
  hunt: { label: "LAST ONE STANDING", sub: "생존" },
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
