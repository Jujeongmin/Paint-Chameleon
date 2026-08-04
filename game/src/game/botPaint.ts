import { FLOOR_COLOR, WALL_COLOR, FAMILIES } from "./arena";

/**
 * What an AI hider paints itself.
 *
 * Bots hide by standing in the designed slots (BOT_HIDES), and a blank white
 * body in a slot is the one thing that would still give them away at a
 * glance — a real hider's first move is to take the colour of what they are
 * standing among. So they do the same thing, with the same tool: a single flat
 * fill, which is all a player can achieve quickly anyway.
 *
 * The palette is the arena's own surfaces and prop families rather than free
 * colours, for the same reason a player picks with the eyedropper: a colour
 * that appears nowhere in the map is worse camouflage than no paint at all.
 *
 * Chosen on the client, not sent by the server. Every client derives the same
 * colour from the same account id, so all of them agree without a single byte
 * on the wire — and the paint of a body nobody is playing is cosmetic, which
 * is exactly the kind of decision that does not need to be authoritative.
 */
const PALETTE: number[] = [
  FLOOR_COLOR,
  WALL_COLOR,
  ...FAMILIES.flatMap((f) => f.colors),
];

/**
 * Digits of a bot account (`bot-7`), or a hash of anything else. The ids are
 * assigned lowest-first and stay stable as humans take seats, so index-derived
 * colours stay put rather than shuffling every time somebody joins.
 */
function seedOf(account: string): number {
  const digits = account.replace(/^bot-/, "");
  const n = Number(digits);
  if (Number.isFinite(n)) return Math.abs(Math.floor(n));

  let hash = 0;
  for (let i = 0; i < account.length; i++) hash = (hash * 31 + account.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function botPaintColor(account: string): number {
  return PALETTE[seedOf(account) % PALETTE.length];
}
