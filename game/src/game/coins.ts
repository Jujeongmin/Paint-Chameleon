/**
 * What a round pays out, mirrored from the server.
 *
 * The client had no copy of this until the offline rig needed to pay itself for
 * catching bots, and it cannot simply import the real one: `server/src/rules.ts`
 * lives outside Vite's root (`game/`), which refuses to serve above itself.
 *
 * So it is a mirror, and mirrors in this project are only allowed on one
 * condition — that something compares them. `check:sync` does, the same way it
 * already holds ARENA, SPAWN_POINTS and SHOT together across the same gap. If
 * the server changes what a catch is worth and this does not, the check goes
 * red rather than the rehearsal quietly paying the wrong amount.
 *
 * KEEP IN SYNC WITH server/src/rules.ts.
 */

export const COINS = { perRound: 5, survived: 5, perCatch: 2 };

/** Pure, and identical to the server's. See the note above about the mirror. */
export function coinsFor(o: { seeker: boolean; caught: boolean; catches: number }): number {
  const catches = Math.max(0, Math.floor(o.catches || 0));
  if (o.seeker) return COINS.perRound + catches * COINS.perCatch;
  return COINS.perRound + (o.caught ? 0 : COINS.survived);
}
