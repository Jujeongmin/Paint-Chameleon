/**
 * Server-side copy of the map generator and scoring rules.
 *
 * KEEP IN SYNC WITH src/game/map.ts and src/game/constants.ts.
 * The server runs in an isolated VM and cannot import from the client tree,
 * so the deterministic generator is duplicated. If the two drift, the server
 * will score camouflage against a different arena than the one players see.
 */

export interface MapBox {
  p: [number, number, number];
  s: [number, number, number];
  c: number;
}

export const ARENA = { size: 44, wallHeight: 7, wallThickness: 1 };
export const FLOOR_COLOR = 0x3a3f4a;
export const WALL_COLOR = 0x7a7d85;
export const MAP_SEED = 20260723;

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

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLUSTERS: { center: [number, number]; radius: number; colors: number[]; count: number }[] = [
  { center: [-13, -13], radius: 6.5, colors: [0xc75b39, 0xe08a5f], count: 9 },
  { center: [13, -13], radius: 6.5, colors: [0x2f8f8a, 0x49b3ad], count: 9 },
  { center: [-13, 13], radius: 6.5, colors: [0x6b4e9e, 0x9179c4], count: 8 },
  { center: [13, 13], radius: 6.5, colors: [0x4a8b3c, 0x6fbf5c], count: 8 },
  { center: [0, 0], radius: 5.5, colors: [0xd4a53f, 0xe8c66b], count: 7 },
  { center: [0, -16], radius: 4.0, colors: [0x7a7d85, 0xb0b3ba], count: 4 },
  { center: [0, 16], radius: 4.0, colors: [0x7a7d85, 0xb0b3ba], count: 4 },
];

export function buildMap(): MapBox[] {
  const boxes: MapBox[] = [];
  const half = ARENA.size / 2;
  const t = ARENA.wallThickness;
  const wy = ARENA.wallHeight / 2;

  boxes.push({ p: [0, wy, -half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR });
  boxes.push({ p: [0, wy, half], s: [ARENA.size + t * 2, ARENA.wallHeight, t], c: WALL_COLOR });
  boxes.push({ p: [-half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR });
  boxes.push({ p: [half, wy, 0], s: [t, ARENA.wallHeight, ARENA.size + t * 2], c: WALL_COLOR });

  const rand = rng(MAP_SEED);
  for (const cl of CLUSTERS) {
    for (let i = 0; i < cl.count; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * cl.radius;
      const x = cl.center[0] + Math.cos(ang) * dist;
      const z = cl.center[1] + Math.sin(ang) * dist;
      const w = 1.2 + rand() * 2.4;
      const d = 1.2 + rand() * 2.4;
      const h = 0.9 + rand() * 2.8;
      const c = cl.colors[Math.floor(rand() * cl.colors.length)];
      boxes.push({ p: [x, h / 2, z], s: [w, h, d], c });
    }
  }
  return boxes;
}

export const MAP_BOXES: MapBox[] = buildMap();

/** True if (x,z) is clear of every box, with margin. */
export function isOpen(x: number, z: number, margin = 0.8): boolean {
  for (const b of MAP_BOXES) {
    if (
      Math.abs(x - b.p[0]) < b.s[0] / 2 + margin &&
      Math.abs(z - b.p[2]) < b.s[2] / 2 + margin
    ) {
      return false;
    }
  }
  return true;
}

/** Pick a spawn point clear of geometry. Falls back to the arena centre. */
export function randomSpawn(): [number, number, number] {
  const limit = ARENA.size / 2 - 2.5;
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() * 2 - 1) * limit;
    const z = (Math.random() * 2 - 1) * limit;
    if (isOpen(x, z)) return [x, 0, z];
  }
  return [0, 0, 0];
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
 * Pure: returns a NEW wallet and never touches the input, so a rejected
 * purchase can't leave a half-applied balance behind.
 */
export function applyPurchase(
  w: WalletState,
  id: string
): { ok: true; wallet: WalletState } | { ok: false; reason: PurchaseFailure } {
  const price = AVATAR_PRICES[id];
  if (price === undefined) return { ok: false, reason: "unknown" };
  if (w.owned.includes(id)) return { ok: false, reason: "owned" };
  if (w.coins < price) return { ok: false, reason: "broke" };

  return {
    ok: true,
    wallet: { coins: w.coins - price, owned: [...w.owned, id], equipped: w.equipped },
  };
}

export function applyEquip(
  w: WalletState,
  id: string
): { ok: true; wallet: WalletState } | { ok: false } {
  if (AVATAR_PRICES[id] === undefined) return { ok: false };
  if (!w.owned.includes(id)) return { ok: false };
  return { ok: true, wallet: { coins: w.coins, owned: [...w.owned], equipped: id } };
}
