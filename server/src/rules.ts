/**
 * Server-side spawn points and scoring rules.
 *
 * KEEP IN SYNC WITH src/game/arena.ts and src/game/constants.ts.
 * The server runs in an isolated VM and cannot import from the client tree,
 * so anything shared is duplicated here and check:sync compares the two.
 */

export const ARENA = { size: 88, wallHeight: 10, wallThickness: 1 };

export const MIN_PLAYERS = 2;
/**
 * Room size. Bounded by SPAWN_POINTS below, not by taste — every player has to
 * start somewhere a body fits, and check:map asserts there are at least this
 * many such places. Raising it past the number of spawn points goes red.
 */
export const MAX_PLAYERS = 10;
/** Public match roster is always this large; vacant seats are hider bots. */
export const MATCH_ROSTER_SIZE = 10;
/** Must match src/game/constants.ts POSES.length — check:sync enforces it. */
export const POSE_COUNT = 4;

/** The social hub holds far more people than a match, and never runs a round. */
export const HUB_CAPACITY = 24;

/**
 * KEEP IN SYNC WITH game/src/game/constants.ts — check:sync compares these, and
 * the reasoning behind each number lives there. In short: hiding is a painting
 * budget (the walk to cover is under 4s), and seeking was cut from 90 to 75
 * because a perfect sweep of every hiding slot takes 73s, so at 90 the clock
 * never bound the seeker at all.
 */
export const PHASE_SECONDS = { hiding: 30, seeking: 75, results: 30 };

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
 * reported position and never looks at a box, and neither does canShoot.
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

export interface RoomBot {
  account: string;
  nameKey: string;
  ready: true;
  role: "hider";
  caught: boolean;
  caughtAt: number | null;
  spectating: boolean;
  pos: [number, number, number];
  rotY: number;
  pose: number;
  moving: false;
  body: "classic";
}

/** Number of AI hiders needed after real people take their seats. */
export function botSeatsFor(humanCount: number): number {
  return Math.max(0, MATCH_ROSTER_SIZE - Math.max(0, Math.floor(humanCount)));
}

/**
 * Stable bot seats for a room. Keeping the lowest ids means one person joining
 * removes exactly one bot without making every remaining body remount.
 */
export function syncRoomBots(existing: unknown, humanCount: number, reset = false): RoomBot[] {
  const old = Array.isArray(existing) ? existing : [];
  return Array.from({ length: botSeatsFor(humanCount) }, (_, i) => {
    const previous = old.find((b: any) => b?.account === `bot-${i}`) as RoomBot | undefined;
    const spawn = SPAWN_POINTS[(i + 2) % SPAWN_POINTS.length];
    return {
      account: `bot-${i}`,
      nameKey: `bot.${i % 7}`,
      ready: true,
      role: "hider",
      caught: reset ? false : !!previous?.caught,
      caughtAt: reset ? null : previous?.caughtAt ?? null,
      spectating: reset ? false : !!previous?.spectating,
      pos: reset || !previous?.pos ? [spawn[0], 0, spawn[1]] : previous.pos,
      rotY: previous?.rotY ?? 0,
      pose: reset ? i % POSE_COUNT : previous?.pose ?? i % POSE_COUNT,
      moving: false,
      body: "classic",
    };
  });
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
  | "sender_missing"
  | "missing"
  | "invalid_target"
  | "cooldown"
  | "not_facing";

export interface ShotRequest {
  phase: string;
  senderIsSeeker: boolean;
  /**
   * True when the shooter's own room-user state could not be found (distinct
   * from `target`, which is nullable for the same reason on the other end).
   * Checked before seekerPos/seekerRotY/lastShotAt are read below, because the
   * caller's defaults for those fields when the state is missing (`0`,
   * `[0,0,0]`) are not neutral: `lastShotAt: 0` clears the cooldown outright
   * (now - 0 is always >= cooldownMs), and `[0,0,0]`/yaw 0 is a plausible
   * arena position, not a sentinel — it would pass the facing cone for a wide
   * arc of the map instead of refusing. A missing sender must fail closed.
   */
  senderMissing: boolean;
  /** null when the account named is not in the room any more. */
  target: { role?: string; caught?: boolean; pos?: number[] } | null;
  seekerPos: number[];
  seekerRotY: number;
  now: number;
  lastShotAt: number;
}

/** Every current seeker may fire, including hiders converted during tag. */
export function canFireAsSeeker(sender: { role?: string } | null | undefined): boolean {
  return sender?.role === "seeker";
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
 * Order matters and check:shot pins more of it than just the one case: phase
 * and senderIsSeeker are cheap state checks and must win even when cooldown
 * or facing would also refuse the same request — "refusal order when two
 * reasons hold at once" pins invalid_target before cooldown, and a second
 * block pins phase/senderIsSeeker ahead of cooldown and facing too. senderMissing
 * runs right after those two and before target/cooldown/facing for the same
 * reason: it guards the defaults those later checks would otherwise trust.
 * None of this is enforced by the type system, only by the pinned tests, so
 * it cannot drift silently.
 */
export function canShoot(o: ShotRequest): { ok: true } | { ok: false; reason: ShotFailure } {
  if (o.phase !== "seeking") return { ok: false, reason: "not_seeking" };
  if (!o.senderIsSeeker) return { ok: false, reason: "not_seeker" };
  if (o.senderMissing) return { ok: false, reason: "sender_missing" };
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
  square: 50,
  tank: 90,
};

/** The profile every account owns for free. */
export const DEFAULT_AVATAR = "classic";

export interface WalletState {
  coins: number;
  owned: string[];
  equipped: string;
  /**
   * Ad bookkeeping. All four are server clock readings, never client ones —
   * the client never sends a timestamp for any of this, because a reward that
   * trusts client time is a reward you type into the console.
   */
  /** When the open ad started, or 0 when none is open. */
  adOpenedAt: number;
  /** When the last reward was granted. */
  adClaimedAt: number;
  /** Whole days since the epoch on the day of the last claim. */
  adDay: number;
  /** Claims made on `adDay`. Meaningless once the day has rolled. */
  adCount: number;
  /**
   * Request ids already paid out, most recent first. The SDK mints one per
   * watch, so this is what stops the same watch being cashed twice — the
   * replay protection the ads guide asks for, kept as a short list rather than
   * a table because the wallet row is the only per-account storage here.
   */
  adRequests: string[];
}

/** What an account looks like before it has ever finished a round. */
export const DEFAULT_WALLET: WalletState = {
  coins: 0,
  owned: [DEFAULT_AVATAR],
  equipped: DEFAULT_AVATAR,
  adOpenedAt: 0,
  adClaimedAt: 0,
  adDay: 0,
  adCount: 0,
  adRequests: [],
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

/**
 * Ad request ids travel the same way, for the same reason. They are minted by
 * the ads SDK, so unlike avatar ids their shape is not ours to promise —
 * anything containing a comma is dropped on the way in rather than silently
 * splitting into two ids that each match nothing.
 */
export function parseRequestIds(s: string): string[] {
  return parseOwned(s);
}

export function serializeRequestIds(ids: string[]): string {
  return ids.filter((id) => !id.includes(",")).join(",");
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

  // Spread, not a fresh literal. These two used to name every field, and the
  // moment the wallet grew ad bookkeeping that became a way to buy the cheapest
  // avatar and have the daily ad cap and cooldown reset as a side effect.
  return {
    ok: true,
    wallet: { ...w, coins: w.coins - price, owned: [...w.owned, id] },
  };
}

export function applyEquip(
  w: WalletState,
  id: string
): { ok: true; wallet: WalletState } | { ok: false } {
  if (!has(id)) return { ok: false };
  if (!w.owned.includes(id)) return { ok: false };
  return { ok: true, wallet: { ...w, owned: [...w.owned], equipped: id } };
}

// ------------------------------------------------------------ ads for coins
//
// Watch an ad, get coins. The reward is granted by the server and only by the
// server, which is the whole reason this is not three lines in the shop panel:
// the client is the one place the "did they really watch it" question cannot be
// answered. So the client never sends a duration, never sends a timestamp, and
// never sends an amount — it says "starting" and later "done", and every number
// in between is read off the server clock.
//
// A watch is one row's worth of state rather than a ticket table. `adOpenedAt`
// IS the ticket: startAd stamps it, claimAd consumes it and zeroes it, and both
// run inside the same per-account $lock the shop already uses. Two claims
// racing one start therefore cannot both win — the second finds a zero.
//
// WHERE THE REAL AD GOES: there is no ad network wired up. `showAd` in
// game/src/ui/adBreak.ts is the seam, and it currently counts down a panel. The
// server side below does not care which it is, and that is deliberate — the
// enforcement is the part that is expensive to add afterwards, so it is here
// first.

export const AD_REWARD = {
  coins: 25,
  /**
   * Minimum server-measured time between start and claim. Deliberately a
   * little under the panel's own countdown so a slow round trip on the start
   * call cannot make an honest full watch land short.
   */
  minWatchMs: 14_000,
  /** Wait after a granted reward before another can start. */
  cooldownMs: 90_000,
  /** Rewards per day. A day is UTC — see dayIndex. */
  dailyCap: 10,
  /**
   * A start this old is abandoned, not paused. Without it, opening an ad and
   * leaving would let you come back a week later and claim instantly, forever,
   * one free reward per session.
   */
  ticketMs: 300_000,
  /**
   * How many spent request ids to remember. Comfortably over dailyCap, so a
   * day's worth of claims can never age out of the list while they could still
   * be replayed within that day.
   */
  recentRequests: 24,
};

export type AdFailure =
  | "cooldown"
  | "cap"
  | "tooSoon"
  | "noAd"
  | "stale"
  | "noRequest"
  | "replay"
  | "unverified";

/**
 * What the client hands in with a claim, plus what the server managed to learn
 * about it.
 *
 * `verified` is deliberately three-valued. `true` and `false` are the ads
 * verifier's answer. `null` means this runtime could not ask — the game server
 * is an isolated-vm with no outbound HTTP (server/README.md's limitations), so
 * until the promised Agent8 helper lands there is nobody to ask. Folding that
 * into `false` would take the ad button away from every honest player; folding
 * it into `true` would be a lie in a type. It stays its own case, and the
 * decision made about it is written down where it is made.
 */
export interface AdTicket {
  requestId: string;
  verified: boolean | null;
}

/**
 * Whole days since the epoch. UTC on purpose: the alternative is the server's
 * local zone, which makes "today" depend on where the machine happens to be
 * and moves the daily reset when it is redeployed elsewhere.
 */
export function dayIndex(now: number): number {
  return Math.floor(now / 86_400_000);
}

/** Claims already made today — zero once the day has rolled past `adDay`. */
export function adsToday(w: WalletState, now: number): number {
  return dayIndex(now) === w.adDay ? Math.max(0, Math.floor(w.adCount) || 0) : 0;
}

export function adsLeft(w: WalletState, now: number): number {
  return Math.max(0, AD_REWARD.dailyCap - adsToday(w, now));
}

/** When the next ad may start; in the past means now. */
export function adReadyAt(w: WalletState, now: number): number {
  void now;
  return (Number.isFinite(w.adClaimedAt) ? w.adClaimedAt : 0) + AD_REWARD.cooldownMs;
}

/**
 * Pure, like applyPurchase: returns a NEW wallet, so a refused start cannot
 * leave a half-opened ad behind.
 */
export function startAd(
  w: WalletState,
  now: number
): { ok: true; wallet: WalletState } | { ok: false; reason: AdFailure } {
  if (adsLeft(w, now) <= 0) return { ok: false, reason: "cap" };
  if (now < adReadyAt(w, now)) return { ok: false, reason: "cooldown" };
  return { ok: true, wallet: { ...w, owned: [...w.owned], adOpenedAt: now } };
}

/**
 * The cap and cooldown are checked AGAIN here, not only in startAd. A start is
 * cheap and unlimited, so anything that only guards the start guards nothing:
 * open eleven ads while the cap still allows one, and eleven claims arrive
 * later. Re-checking at grant time is what actually holds the cap.
 */
export function claimAd(
  w: WalletState,
  now: number,
  ticket: AdTicket
): { ok: true; wallet: WalletState; coins: number } | { ok: false; reason: AdFailure; wallet?: WalletState } {
  const opened = Number.isFinite(w.adOpenedAt) ? w.adOpenedAt : 0;
  if (opened <= 0) return { ok: false, reason: "noAd" };

  // The SDK mints a request id per watch. No id means the caller never played
  // one — a hand-rolled claim, or a client old enough to predate this check.
  const requestId = typeof ticket.requestId === "string" ? ticket.requestId.trim() : "";
  if (!requestId || requestId.includes(",")) {
    return { ok: false, reason: "noRequest", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  // Replay: one watch, one payout. Checked before the clock rules so that
  // resending yesterday's id reads as what it is rather than as "too soon".
  const spent = Array.isArray(w.adRequests) ? w.adRequests : [];
  if (spent.includes(requestId)) {
    return { ok: false, reason: "replay", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  // false is the verifier saying no. null is nobody having been able to ask —
  // see AdTicket. A null grants, and the time rules below are what stands in
  // for the verifier until this runtime can reach it.
  if (ticket.verified === false) {
    return { ok: false, reason: "unverified", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  // Clock went backwards, or the row was written by a different machine. Treat
  // it as abandoned rather than as an instantly-satisfied watch.
  const watched = now - opened;
  if (watched > AD_REWARD.ticketMs || watched < 0) {
    return { ok: false, reason: "stale", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }
  if (watched < AD_REWARD.minWatchMs) return { ok: false, reason: "tooSoon" };

  if (adsLeft(w, now) <= 0) {
    return { ok: false, reason: "cap", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }
  if (now < adReadyAt(w, now)) {
    return { ok: false, reason: "cooldown", wallet: { ...w, owned: [...w.owned], adOpenedAt: 0 } };
  }

  const today = dayIndex(now);
  return {
    ok: true,
    coins: AD_REWARD.coins,
    wallet: {
      ...w,
      owned: [...w.owned],
      coins: (Number.isFinite(w.coins) ? w.coins : 0) + AD_REWARD.coins,
      adOpenedAt: 0,
      adClaimedAt: now,
      adDay: today,
      adCount: adsToday(w, now) + 1,
      // Newest first, oldest dropped: the list is a replay guard, and the
      // claims most worth replaying are the ones that just happened.
      adRequests: [requestId, ...spent].slice(0, AD_REWARD.recentRequests),
    },
  };
}

// ----------------------------------------------------------------- game modes
//
// Two rooms, two answers to the same question: what happens when a hider is
// shot. Everything else about a round is identical, so the difference is
// written as data and one pure function rather than as two round systems.
//
// KEEP IN SYNC WITH game/src/game/modes.ts — check:modes compares them and
// drives the decision table from both sides.

export type GameMode = "tag" | "hunt";

/**
 * The modes that exist. Ids only — no display text.
 *
 * The server has no business holding words a player reads: it cannot know
 * which language they picked, and a Korean string sitting in a rules file was
 * a translation nobody could reach. Names live in game/src/ui/i18n.ts, keyed
 * off these ids, and check:modes asserts every id has one in both languages.
 */
export const GAME_MODE_IDS: GameMode[] = ["tag", "hunt"];

export const DEFAULT_MODE: GameMode = "tag";

export function isGameMode(v: unknown): v is GameMode {
  return v === "tag" || v === "hunt";
}

/** Anything the round rules need to know about one player. */
export interface RoundUser {
  account: string;
  role?: string;
  caught?: boolean;
  /** Removed from play: hunt mode only, and only after being caught. */
  spectating?: boolean;
}

/**
 * What a successful shot does to the target, as a state patch.
 *
 * `caught` means different things in the two modes and that is the whole point
 * of routing it through here. In hunt it is the end of your round. In tag it is
 * a change of side, so the flag is NOT set — it drives the dimmed body and the
 * "발각" result row, and a player who is now hunting is neither. Their catch is
 * recorded as `convertedAt` instead, which is what the scoring reads.
 */
export function catchPatch(mode: GameMode, now: number): Record<string, unknown> {
  if (mode === "tag") {
    return {
      role: "seeker",
      caught: false,
      caughtAt: null,
      convertedAt: now,
      // A fresh seeker must not inherit a cooldown, and must be able to shoot
      // immediately — being converted and then unable to act reads as a bug.
      lastShotAt: 0,
      pose: 0,
    };
  }
  return { caught: true, caughtAt: now, spectating: true };
}

/**
 * Is the hunt over?
 *
 * One rule for both modes, which is possible precisely because tag moves the
 * caught player's ROLE rather than setting a flag: "nobody left to find" is
 * then the same sentence in each. The seeker count guard stops an empty room,
 * or one whose seeker walked out, from reading as a finished round.
 */
export function huntOver(users: RoundUser[]): boolean {
  let seekers = 0;
  let live = 0;
  for (const u of users) {
    if (u.role === "seeker") seekers++;
    else if (!u.caught) live++;
  }
  return seekers > 0 && live === 0;
}

/** Players who are still playing rather than watching. */
export function activeHiders(users: RoundUser[]): number {
  return users.filter((u) => u.role !== "seeker" && !u.caught).length;
}

/**
 * Whether a room will take someone walking in off the street.
 *
 * Between rounds only — during the results screen as well as the lobby, so a
 * room that is about to restart can fill up rather than restarting short.
 * Joining mid-hunt is deliberately not allowed: in tag you would arrive as the
 * only hider in a room full of seekers, and in hunt you would arrive with the
 * hiding phase already spent.
 */
export function acceptsJoiners(phase: string, playerCount: number, max: number): boolean {
  if (playerCount >= max) return false;
  return phase === "lobby" || phase === "results";
}

/**
 * After the results screen: start another round, or fall back to the lobby.
 *
 * Not going back to the lobby every time is the point — a room that has enough
 * people simply plays again, and anybody who wanted to stop had the whole
 * results phase to press leave. Dropping below the minimum sends what is left
 * back to the lobby rather than starting a round nobody can play.
 */
export function afterResults(playerCount: number, minPlayers: number): "restart" | "lobby" {
  return playerCount >= minPlayers ? "restart" : "lobby";
}
