/**
 * Server-side spawn points and scoring rules.
 *
 * KEEP IN SYNC WITH src/game/arena.ts and src/game/constants.ts.
 * The server runs in an isolated VM and cannot import from the client tree,
 * so anything shared is duplicated here and check:sync compares the two.
 */

export const ARENA = { size: 88, wallHeight: 7, wallThickness: 1 };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
/** Must match src/game/constants.ts POSES.length — check:sync enforces it. */
export const POSE_COUNT = 4;

/** The social hub holds far more people than a match, and never runs a round. */
export const HUB_CAPACITY = 24;

export const PHASE_SECONDS = { hiding: 45, seeking: 90, results: 10 };

export const TAG = { maxDistance: 2.6, minFacingDot: 0.55, cooldownMs: 700 };

export const SCORE = {
  hiderSurvived: 100,
  hiderPerSecondAlive: 1,
  seekerPerCatch: 75,
};

/** Paint is cosmetic — the server only relays it, so these bound abuse, not fairness. */
export const PAINT_LIMITS = { maxBatch: 32, maxRadius: 120 };

/**
 * src/game/constants.ts의 MOVE.seekerSpeed(둘 중 더 빠른 쪽)와 동기화 유지 —
 * check:sync가 검사. 역할별로 나누지 않고 더 빠른 쪽을 공통 상한으로 쓴다: 이
 * 테스트 하네스는 블랙박스라 실제 라운드 진행 없이는 "seeker" 역할을 만들 방법이
 * 없어 역할별 값을 검증할 수 없고, 통합 상한을 써도 hider가 자기 실제 속도(6.0)
 * 보다 살짝 더 여유(6.8까지)를 갖는 정도의 미미한 손해만 있다.
 */
export const MOVE_SPEED_CAP = 6.8;
/** 네트워크 지터/전송 버스트에 대한 여유 배수. */
export const SPEED_GRACE = 1.5;
/** elapsed 계산의 하한(ms) — 버스트 전송으로 elapsed≈0이 되어 정상 이동까지 clamp되는 것 방지. */
export const MIN_DT_MS = 50;
/** elapsed calculation ceiling (ms) — idle time must not bank an unbounded movement allowance; a legitimate player who was standing still always starts their next move from rest (one frame's worth of distance), so a 1s ceiling gives ample headroom for lag/idle without reopening the teleport hole. */
export const MAX_DT_MS = 1000;

/** Collection name for the cross-room, persistent leaderboard. */
export const LEADERBOARD_COLLECTION = "leaderboard";

export interface LeaderboardEntry {
  account: string;
  nick: string;
  total: number;
}
export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
}

/**
 * Attach 1-based ranks to an already sorted-desc, already-limited list. Pure
 * and side-effect-free so the numbering can be unit tested without a live
 * collection — it does NOT sort; callers must pass pre-sorted input.
 */
export function attachRanks(sorted: LeaderboardEntry[]): RankedLeaderboardEntry[] {
  return sorted.map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Hider spawn points — must match src/game/arena.ts, and check:sync compares
 * them element by element.
 *
 * The only reason the server ever carried arena geometry was randomSpawn's
 * search for an open spot. A hand-picked list does that job, so the whole map
 * copy is gone: movement validation clamps distance travelled since the last
 * reported position and never looks at a box, and neither does the tag check.
 */
export const SPAWN_POINTS: [number, number][] = [
  [-34, -34], [-34, 0], [-34, 38],
  [0, -34], [0, 34],
  [34, -34], [34, 0], [32, 34],
  [-14, -38], [16, -38], [-24, 38], [16, 38],
];

export function randomSpawn(): [number, number, number] {
  const p = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  return [p[0], 0, p[1]];
}

// ------------------------------------------------------------ avatar shop

/** Collection name for per-account coins and owned avatars. */
export const WALLET_COLLECTION = "wallets";

/** Coins earned per round. Deliberately a small, readable scale next to SCORE. */
export const COINS = { perRound: 5, survived: 5, perCatch: 2 };

/**
 * Prices, keyed by body profile id.
 * KEEP IN SYNC WITH src/game/bodies.ts BODIES — check:sync enforces it. The
 * server is the only authority on what a purchase costs; the client catalogue
 * is display only.
 */
export const AVATAR_PRICES: Record<string, number> = {
  classic: 0,
  bean: 40,
  stick: 60,
  tank: 90,
};

/** The profile every account owns for free. */
export const DEFAULT_AVATAR = "classic";

export interface WalletState {
  coins: number;
  owned: string[];
  equipped: string;
}

/** What an account looks like before it has ever finished a round. */
export const DEFAULT_WALLET: WalletState = {
  coins: 0,
  owned: [DEFAULT_AVATAR],
  equipped: DEFAULT_AVATAR,
};

/**
 * Owned avatars travel as one comma-separated string rather than an array:
 * whether this SDK's collections filter and sort array fields correctly isn't
 * documented anywhere we can check, and avatar ids are lowercase ASCII, so a
 * comma can never appear inside one.
 */
export function parseOwned(s: string): string[] {
  return String(s || "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function serializeOwned(ids: string[]): string {
  return ids.join(",");
}

export function coinsFor(o: { seeker: boolean; caught: boolean; catches: number }): number {
  const catches = Math.max(0, Math.floor(o.catches || 0));
  if (o.seeker) return COINS.perRound + catches * COINS.perCatch;
  return COINS.perRound + (o.caught ? 0 : COINS.survived);
}

export type PurchaseFailure = "unknown" | "owned" | "broke";

/**
 * `AVATAR_PRICES` is a plain object literal, so `AVATAR_PRICES["toString"]`
 * (or "constructor", "__proto__", "valueOf", ...) resolves to an inherited
 * `Object.prototype` function rather than `undefined` — the `=== undefined`
 * check below would miss it, and the function would then coerce to NaN in the
 * balance comparison, which is never `<` anything. `hasOwnProperty` closes
 * that. (`src/game/bodies.ts`'s `profileFor` sidesteps the whole class of bug
 * by keying a `Map` instead of a plain object — same idea, different tool.)
 */
const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(AVATAR_PRICES, id);

/**
 * Pure: returns a NEW wallet and never touches the input, so a rejected
 * purchase can't leave a half-applied balance behind.
 */
export function applyPurchase(
  w: WalletState,
  id: string
): { ok: true; wallet: WalletState } | { ok: false; reason: PurchaseFailure } {
  if (!has(id)) return { ok: false, reason: "unknown" };
  const price = AVATAR_PRICES[id];
  if (w.owned.includes(id)) return { ok: false, reason: "owned" };
  // A non-finite balance (e.g. corrupted to NaN) must never read as "enough" —
  // every comparison against NaN is false, so `w.coins < price` alone would
  // let it through.
  if (!Number.isFinite(w.coins) || w.coins < price) return { ok: false, reason: "broke" };

  return {
    ok: true,
    wallet: { coins: w.coins - price, owned: [...w.owned, id], equipped: w.equipped },
  };
}

export function applyEquip(
  w: WalletState,
  id: string
): { ok: true; wallet: WalletState } | { ok: false } {
  if (!has(id)) return { ok: false };
  if (!w.owned.includes(id)) return { ok: false };
  return { ok: true, wallet: { coins: w.coins, owned: [...w.owned], equipped: id } };
}
