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

export const PHASE_SECONDS = { hiding: 30, seeking: 90, results: 10 };

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

/**
 * Where the seeker waits out the hiding phase.
 *
 * Must match CELL_SPAWN in src/game/cell.ts — check:sync compares them. The
 * server needs no other part of the cell: it never simulates movement, and the
 * cell's walls are a client-side collision concern.
 */
export const CELL_SPAWN: [number, number, number] = [0, -8, 0];

/**
 * Where the seeker is teleported when the hunt starts (hiding -> seeking).
 * Must match HUNT_START in src/game/cell.ts — check:sync compares them.
 */
export const HUNT_START: [number, number, number] = [0, 0, 0];

// ------------------------------------------------------------ the seeker's shot

/**
 * The seeker's gun.
 *
 * There is no maxDistance any more: the shot is a hitscan with unlimited range
 * and the client decides whether the line of sight was clear, because the
 * server has no map to check it against. That trade, and what it costs, is the
 * first section of the design doc — read it before adding a distance limit
 * back, because any number chosen here would be arbitrary.
 *
 * KEEP IN SYNC WITH SHOT in game/src/game/constants.ts — check:sync compares them.
 */
export const SHOT = {
  /** The seeker's forward vector must have at least this dot with the direction to the target. */
  minFacingDot: 0.55,
  cooldownMs: 700,
};

export type ShotFailure =
  | "not_seeking"
  | "not_seeker"
  | "missing"
  | "invalid_target"
  | "cooldown"
  | "not_facing";

export interface ShotRequest {
  phase: string;
  senderIsSeeker: boolean;
  /** null when the account named is not in the room any more. */
  target: { role?: string; caught?: boolean; pos?: number[] } | null;
  seekerPos: number[];
  seekerRotY: number;
  now: number;
  lastShotAt: number;
}

/** Coerce anything off the wire to a real number. */
function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * How much of the seeker's facing points at the target, on the horizontal plane.
 * 1 is dead ahead, 0 is square to the side, -1 is directly behind.
 *
 * Height is deliberately excluded — shooting up at someone on a crate is still
 * facing them, and folding y in would refuse it.
 *
 * yaw 0 faces +Z (see game/src/game/movement.ts). Inverting that would let the
 * seeker shoot whatever is behind them, which is why check:shot pins all four
 * cardinal directions rather than just the forward case.
 */
export function facingDot(from: number[], to: number[], rotY: number): number {
  const dx = n(to?.[0]) - n(from?.[0]);
  const dz = n(to?.[2]) - n(from?.[2]);
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return 1; // standing on top of each other counts as facing
  return (dx / length) * Math.sin(n(rotY)) + (dz / length) * Math.cos(n(rotY));
}

/**
 * Pure so it can be checked: the harness cannot drive a room into the seeking
 * phase, so this decision is unreachable from a server test.
 *
 * The refusal order below is exactly what check:shot's "refusal order when
 * two reasons hold at once" case pins — invalid_target before cooldown — so
 * it cannot drift silently.
 */
export function canShoot(o: ShotRequest): { ok: true } | { ok: false; reason: ShotFailure } {
  if (o.phase !== "seeking") return { ok: false, reason: "not_seeking" };
  if (!o.senderIsSeeker) return { ok: false, reason: "not_seeker" };
  if (!o.target) return { ok: false, reason: "missing" };
  if (o.target.role !== "hider" || o.target.caught) return { ok: false, reason: "invalid_target" };
  if (n(o.now) - n(o.lastShotAt) < SHOT.cooldownMs) return { ok: false, reason: "cooldown" };

  // A target with no position, or a corrupted one, must not read as "in front
  // of me": n() turns it into the origin, which for a seeker also at the
  // origin would otherwise pass as facing.
  const pos = o.target.pos;
  const usable = Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[2]);
  if (!usable) return { ok: false, reason: "not_facing" };

  if (facingDot(o.seekerPos, pos, o.seekerRotY) < SHOT.minFacingDot) {
    return { ok: false, reason: "not_facing" };
  }
  return { ok: true };
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
