/**
 * Paint Chameleon — authoritative game server.
 *
 * Phase machine runs in $roomTick (200-1000ms). Round deadlines are wall-clock
 * timestamps rather than accumulated deltas so a variable tick rate can't drift.
 * Shot resolution is a remote function, not a tick step, so catches feel instant.
 *
 * Paint is purely cosmetic: players only paint themselves and nothing is scored
 * on it, so the server relays dabs to the room without interpreting them.
 */

import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  HUB_CAPACITY,
  POSE_COUNT,
  PHASE_SECONDS,
  canShoot,
  canFireAsSeeker,
  type ShotFailure,
  SCORE,
  PAINT_LIMITS,
  MOVE_SPEED_CAP,
  SPEED_GRACE,
  MIN_DT_MS,
  MAX_DT_MS,
  LEADERBOARD_COLLECTION,
  attachRanks,
  randomSpawn,
  CELL_SPAWN,
  HUNT_START,
  type RankedLeaderboardEntry,
  WALLET_COLLECTION,
  DEFAULT_WALLET,
  applyPurchase,
  applyEquip,
  parseOwned,
  serializeOwned,
  coinsFor,
  DEFAULT_MODE,
  acceptsJoiners,
  afterResults,
  catchPatch,
  huntOver,
  isGameMode,
  type GameMode,
  startAd,
  claimAd,
  syncRoomBots,
  type WalletState,
  type PurchaseFailure,
  type AdFailure,
} from "./rules";

type Phase = "lobby" | "hiding" | "seeking" | "results";
/** Hub rooms are social space; game rooms run rounds. Never mix them up in matchmaking. */
type RoomKind = "hub" | "game";

function sanitizeNick(nick: unknown): string {
  const s = typeof nick === "string" ? nick.trim().slice(0, 16) : "";
  return s.length ? s : "Player";
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function clamp01(v: unknown): number {
  const n = num(v);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Clamp (x,z) to within maxDist of (px,pz) — the movement speed cap. */
function clampMoveXZ(px: number, pz: number, x: number, z: number, maxDist: number): [number, number] {
  const dx = x - px;
  const dz = z - pz;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDist || dist === 0) return [x, z];
  const scale = maxDist / dist;
  return [px + dx * scale, pz + dz * scale];
}

// ------------------------------------------------------------- round helpers

/** Choose the player who has gone longest without being the seeker. */
function pickSeeker(users: Array<Record<string, any>>, history: string[]): string {
  let best = users[0].account;
  let bestRank = -1;
  for (const u of users) {
    const idx = history.lastIndexOf(u.account);
    const rank = idx === -1 ? Number.MAX_SAFE_INTEGER : history.length - idx;
    if (rank > bestRank) {
      bestRank = rank;
      best = u.account;
    }
  }
  return best;
}

async function startRound(roomId: string, users: Array<Record<string, any>>, state: Record<string, any>) {
  const history: string[] = Array.isArray(state.seekerHistory) ? state.seekerHistory : [];
  const seeker = pickSeeker(users, history);
  const now = Date.now();

  for (const u of users) {
    const isSeeker = u.account === seeker;
    await $global.updateRoomUserState(roomId, u.account, {
      role: isSeeker ? "seeker" : "hider",
      caught: false,
      caughtAt: null,
      pose: 0,
      ready: false,
      pos: isSeeker ? CELL_SPAWN : randomSpawn(),
      rotY: 0,
      lastShotAt: 0,
      lastMoveAt: now,
      // Both are mode-specific and both are per-round: a player converted or
      // eliminated last round starts this one as an ordinary hider.
      convertedAt: null,
      spectating: false,
    });
  }

  await $global.updateRoomState(roomId, {
    phase: "hiding" as Phase,
    round: num(state.round) + 1,
    seeker,
    seekerHistory: [...history, seeker].slice(-12),
    phaseEndsAt: now + PHASE_SECONDS.hiding * 1000,
    lastResults: null,
    bots: syncRoomBots(state.bots, users.length, true),
  });

  // Everyone starts each round unpainted.
  await $global.broadcastToAll("roundStart", { roomId, seeker });
}

async function endRound(roomId: string, users: Array<Record<string, any>>, state: Record<string, any>) {
  const now = Date.now();
  const scores: Record<string, number> = { ...(state.scores || {}) };
  const results: Array<Record<string, any>> = [];
  const seekingStartedAt = num(state.phaseEndsAt) - PHASE_SECONDS.seeking * 1000;

  const mode: GameMode = isGameMode(state.mode) ? state.mode : DEFAULT_MODE;
  let catches = 0;

  for (const u of users) {
    // The original seeker is scored below. In tag, everyone else wearing that
    // role got there by being caught, so they are scored as the hider they
    // were — with the conversion standing in for the catch.
    if (u.account === state.seeker) continue;

    const converted = mode === "tag" && !!u.convertedAt;
    let gained: number;
    if (u.caught || converted) {
      catches++;
      const endedAt = converted ? num(u.convertedAt, now) : num(u.caughtAt, now);
      const aliveMs = Math.max(0, endedAt - seekingStartedAt);
      gained = Math.round((aliveMs / 1000) * SCORE.hiderPerSecondAlive);
    } else {
      gained = SCORE.hiderSurvived;
    }

    scores[u.account] = (scores[u.account] || 0) + gained;
    results.push({
      account: u.account,
      nick: u.nick,
      caught: !!u.caught || converted,
      gained,
    });
  }

  for (const bot of syncRoomBots(state.bots, users.length)) {
    if (bot.caught) catches++;
    const gained = bot.caught ? 0 : SCORE.hiderSurvived;
    results.push({ account: bot.account, nick: bot.nameKey, nameKey: bot.nameKey, caught: bot.caught, gained, bot: true });
  }

  if (state.seeker) {
    const gained = catches * SCORE.seekerPerCatch;
    scores[state.seeker] = (scores[state.seeker] || 0) + gained;
    results.push({ account: state.seeker, nick: "", caught: false, gained, seeker: true });
  }

  await $global.updateRoomState(roomId, {
    phase: "results" as Phase,
    phaseEndsAt: now + PHASE_SECONDS.results * 1000,
    scores,
    lastResults: results,
  });

  // The seeker's own result entry carries an empty nick (the results overlay
  // looks it up from the room's player list instead), but the leaderboard
  // collection outlives the room, so every entry needs a real one. This loop
  // now does two persistent, best-effort writes per player — the leaderboard
  // total and this round's coin grant — and both run after the phase
  // transition above and never let a failure escape: the round must always be
  // able to end even if a write doesn't land. The leaderboard is a
  // non-critical panel that re-polls on its own; a dropped coin grant is lost
  // rather than retried (see grantCoins below for why retrying is worse).
  for (const r of results) {
    if (r.bot) continue;
    const nick = r.seeker ? users.find((u) => u.account === r.account)?.nick ?? "" : r.nick;
    try {
      await upsertLeaderboard(r.account, nick, r.gained);
    } catch {
      // Best-effort — a transient collection-write failure must not corrupt
      // or re-trigger this round's results, which have already been published.
    }
    try {
      await grantCoins(r.account, coinsFor({ seeker: !!r.seeker, caught: !!r.caught, catches }));
    } catch {
      // Same contract as the leaderboard write above. A round's coins are
      // dropped rather than retried: retrying would double-pay whoever the
      // partial failure already credited.
    }
  }
}

/** Add this round's points onto the account's permanent leaderboard total. */
async function upsertLeaderboard(account: string, nick: string, gained: number) {
  const existing = (await $global.getCollectionItems(LEADERBOARD_COLLECTION, {
    filters: [{ field: "account", operator: "==", value: account }],
  })) as any[];

  if (existing.length) {
    const item = existing[0];
    await $global.updateCollectionItem(LEADERBOARD_COLLECTION, {
      __id: item.__id,
      total: num(item.total) + gained,
      nick: nick || item.nick,
    });
  } else {
    await $global.addCollectionItem(LEADERBOARD_COLLECTION, { account, nick: nick || "익명", total: gained });
  }
}

/**
 * An account with no row yet reads back as the default wallet rather than
 * nothing, so the shop works before a player has finished their first round.
 */
async function readWallet(account: string): Promise<{ wallet: WalletState; __id: string | null }> {
  const rows = (await $global.getCollectionItems(WALLET_COLLECTION, {
    filters: [{ field: "account", operator: "==", value: account }],
  })) as any[];

  if (!rows.length) return { wallet: { ...DEFAULT_WALLET, owned: [...DEFAULT_WALLET.owned] }, __id: null };

  const row = rows[0];
  const owned = parseOwned(row.owned);
  return {
    wallet: {
      coins: num(row.coins),
      // A row written before this account owned anything must still include
      // the free avatar, or the player loses the body they're standing in.
      owned: owned.length ? owned : [...DEFAULT_WALLET.owned],
      equipped: row.equipped || DEFAULT_WALLET.equipped,
      // Rows written before ads existed have none of these columns, and num()
      // turns the resulting undefined into 0 — which is exactly "never watched
      // one", so an old account starts with a full daily allowance.
      adOpenedAt: num(row.adOpenedAt),
      adClaimedAt: num(row.adClaimedAt),
      adDay: num(row.adDay),
      adCount: num(row.adCount),
    },
    __id: row.__id,
  };
}

async function writeWallet(account: string, __id: string | null, wallet: WalletState) {
  const fields = {
    coins: wallet.coins,
    owned: serializeOwned(wallet.owned),
    equipped: wallet.equipped,
    adOpenedAt: wallet.adOpenedAt,
    adClaimedAt: wallet.adClaimedAt,
    adDay: wallet.adDay,
    adCount: wallet.adCount,
  };
  if (__id) await $global.updateCollectionItem(WALLET_COLLECTION, { __id, ...fields });
  else await $global.addCollectionItem(WALLET_COLLECTION, { account, ...fields });
}

/** Add a round's earnings to an account's balance. */
async function grantCoins(account: string, amount: number) {
  if (amount <= 0) return;
  await $lock("wallet:" + account, async () => {
    const { wallet, __id } = await readWallet(account);
    await writeWallet(account, __id, { ...wallet, coins: wallet.coins + amount });
  });
}

// ------------------------------------------------------------------- server

export class Server {
  /**
   * Enter the social hub. Everyone lands here first; matches are started from
   * a portal inside it.
   */
  async joinHub(nick: string): Promise<{ roomId: string }> {
    // Collection storage is the slowest dependency here. Start it before
    // matchmaking so network waits overlap instead of stacking up.
    const walletPromise = readWallet($sender.account);
    const roomId = await $lock("matchmaking", async () => {
      const states = await $global.getAllRoomStates();
      let target: string | undefined;
      for (const s of states) {
        const count = Array.isArray(s.$users) ? s.$users.length : 0;
        if (s.kind === "hub" && count < HUB_CAPACITY) {
          target = s.roomId;
          break;
        }
      }
      return await $global.joinRoom(target);
    });

    const [state, { wallet }] = await Promise.all([
      $global.getRoomState(roomId),
      walletPromise,
    ]);
    const writes: Promise<unknown>[] = [];
    if (state.kind !== "hub") {
      writes.push($global.updateRoomState(roomId, { kind: "hub" as RoomKind, phase: null }));
    }
    writes.push($global.updateRoomUserState(roomId, $sender.account, {
      nick: sanitizeNick(nick),
      body: wallet.equipped,
      pos: [(Math.random() - 0.5) * 6, 0, 8 + Math.random() * 3],
      rotY: Math.PI,
      pose: 0,
      moving: false,
      lastMoveAt: Date.now(),
    }));
    await Promise.all(writes);

    return { roomId };
  }

  /** Join an open lobby, or open a new one. Returns the room id. */
  async joinGame(nick: string, requestedMode?: string): Promise<{ roomId: string }> {
    const mode: GameMode = isGameMode(requestedMode) ? requestedMode : DEFAULT_MODE;
    const walletPromise = readWallet($sender.account);
    // Leave the hub first — a player is only ever in one room.
    if ($sender.roomId) await $global.leaveRoom();

    const roomId = await $lock("matchmaking", async () => {
      const states = await $global.getAllRoomStates();
      let target: string | undefined;
      for (const s of states) {
        // Opt in, don't opt out: a room with no kind yet (or a hub, whose phase
        // is null and would read as "lobby") must never absorb a match.
        if (s.kind !== "game") continue;
        // Never put someone in a room playing the other game. The two modes
        // disagree about what being caught means, which is the whole of the
        // difference, so a mixed room would be neither.
        if ((isGameMode(s.mode) ? s.mode : DEFAULT_MODE) !== mode) continue;
        const count = Array.isArray(s.$users) ? s.$users.length : 0;
        // Between rounds, not only in the lobby: a room on its results screen
        // is about to play again and should fill up first.
        if (acceptsJoiners(s.phase || "lobby", count, MAX_PLAYERS)) {
          target = s.roomId;
          break;
        }
      }
      return await $global.joinRoom(target);
    });

    const [state, { wallet }] = await Promise.all([
      $global.getRoomState(roomId),
      walletPromise,
    ]);
    const humanCount = Array.isArray(state.$users) ? state.$users.length : 1;
    const bots = syncRoomBots(state.bots, humanCount, !state.phase);
    const roomPatch = !state.phase
      ? {
        kind: "game" as RoomKind,
        mode,
        phase: "lobby" as Phase,
        round: 0,
        seeker: null,
        seekerHistory: [],
        scores: {},
        phaseEndsAt: 0,
        lastResults: null,
        bots,
      }
      : { bots };

    await Promise.all([
      $global.updateRoomState(roomId, roomPatch),
      $global.updateRoomUserState(roomId, $sender.account, {
      nick: sanitizeNick(nick),
      body: wallet.equipped,
      ready: false,
      role: "hider",
      caught: false,
      caughtAt: null,
      pos: randomSpawn(),
      rotY: 0,
      pose: 0,
      moving: false,
      lastShotAt: 0,
      lastMoveAt: Date.now(),
      convertedAt: null,
      spectating: false,
      }),
    ]);

    return { roomId };
  }

  /** Diagnostic only — used by tests to inspect matchmaking state. */
  async __rooms(): Promise<any[]> {
    const states = await $global.getAllRoomStates();
    return states.map((s: any) => ({
      roomId: s.roomId,
      kind: s.kind ?? null,
      phase: s.phase ?? null,
      users: Array.isArray(s.$users) ? s.$users.length : 0,
      bots: Array.isArray(s.bots) ? s.bots : [],
    }));
  }

  /** Back out of a match and into the hub. */
  async returnToHub(nick: string): Promise<{ roomId: string }> {
    if ($sender.roomId) await $global.leaveRoom();
    return await this.joinHub(nick);
  }

  async leaveGame(): Promise<void> {
    await $global.leaveRoom();
  }

  async setReady(ready: boolean): Promise<void> {
    // Ready is a commitment for this lobby. startRound resets it for the next
    // round; clients cannot hold everyone hostage by toggling it back off.
    if (!ready) return;
    const mine = await $room.getMyState();
    if (mine.ready) return;
    await $room.updateMyState({ ready: true });
  }

  /** Own room-user state. Clients get this via useRoomMyState(); handy for tests. */
  async getMyState(): Promise<Record<string, any>> {
    return await $room.getMyState();
  }

  /** Top 10 by all-time total, plus the caller's own rank if they're outside it. */
  async getLeaderboard(): Promise<{ top: RankedLeaderboardEntry[]; me: RankedLeaderboardEntry | null }> {
    const topRaw = (await $global.getCollectionItems(LEADERBOARD_COLLECTION, {
      orderBy: [{ field: "total", direction: "desc" }],
      limit: 10,
    })) as any[];
    const top = attachRanks(
      topRaw.map((item) => ({ account: item.account, nick: item.nick || "익명", total: num(item.total) }))
    );

    if (top.some((t) => t.account === $sender.account)) {
      return { top, me: null };
    }

    const mineRaw = (await $global.getCollectionItems(LEADERBOARD_COLLECTION, {
      filters: [{ field: "account", operator: "==", value: $sender.account }],
    })) as any[];
    if (!mineRaw.length) return { top, me: null };

    const mine = mineRaw[0];
    const higher = await $global.countCollectionItems(LEADERBOARD_COLLECTION, {
      filters: [{ field: "total", operator: ">", value: num(mine.total) }],
    });

    return {
      top,
      me: { account: mine.account, nick: mine.nick || "익명", total: num(mine.total), rank: higher + 1 },
    };
  }

  async getWallet(): Promise<WalletState> {
    const { wallet } = await readWallet($sender.account);
    return wallet;
  }

  /**
   * Server-authoritative: the client's catalogue is display only, and every
   * price, balance and ownership check happens here.
   *
   * The whole read-decide-write runs under a lock. Without it a double-click
   * sends two requests that both read the same balance and both succeed,
   * handing out two avatars for the price of one.
   */
  async buyAvatar(
    id: string
  ): Promise<{ ok: true; wallet: WalletState } | { ok: false; reason: PurchaseFailure }> {
    const account = $sender.account;
    return await $lock("wallet:" + account, async () => {
      const { wallet, __id } = await readWallet(account);
      const result = applyPurchase(wallet, String(id ?? ""));
      if (!result.ok) return result;

      await writeWallet(account, __id, result.wallet);
      return { ok: true as const, wallet: result.wallet };
    });
  }

  /**
   * Open an ad. Returns the wallet so the client can show the remaining count
   * without a second round trip, and `startedAt` so it knows the server agreed
   * — the client's own clock is never the one that decides anything here.
   *
   * Under the same wallet lock as buying: a start writes the row, and a start
   * racing a claim would otherwise read a wallet the claim is about to replace.
   */
  async startAdWatch(): Promise<
    { ok: true; wallet: WalletState } | { ok: false; reason: AdFailure; wallet: WalletState }
  > {
    const account = $sender.account;
    return await $lock("wallet:" + account, async () => {
      const { wallet, __id } = await readWallet(account);
      const result = startAd(wallet, Date.now());
      if (!result.ok) return { ok: false as const, reason: result.reason, wallet };

      await writeWallet(account, __id, result.wallet);
      return { ok: true as const, wallet: result.wallet };
    });
  }

  /**
   * Claim the reward. Every check that matters lives in claimAd and runs on
   * this side of the wire; the client sends nothing but the request itself.
   *
   * A refusal can still carry a wallet to write — a stale or over-cap ticket
   * has to be cleared, or it sits in the row and gets retried forever.
   */
  async claimAdReward(): Promise<
    | { ok: true; wallet: WalletState; coins: number }
    | { ok: false; reason: AdFailure; wallet: WalletState }
  > {
    const account = $sender.account;
    return await $lock("wallet:" + account, async () => {
      const { wallet, __id } = await readWallet(account);
      const result = claimAd(wallet, Date.now());

      if (!result.ok) {
        if (result.wallet) await writeWallet(account, __id, result.wallet);
        return { ok: false as const, reason: result.reason, wallet: result.wallet ?? wallet };
      }

      await writeWallet(account, __id, result.wallet);
      return { ok: true as const, wallet: result.wallet, coins: result.coins };
    });
  }

  async equipAvatar(id: string): Promise<{ ok: boolean }> {
    const account = $sender.account;
    const equipped = await $lock("wallet:" + account, async () => {
      const { wallet, __id } = await readWallet(account);
      const result = applyEquip(wallet, String(id ?? ""));
      if (!result.ok) return null;

      await writeWallet(account, __id, result.wallet);

      // Peers render each other from room state, so the new body has to land
      // there too — the wallet alone is invisible to everyone else. This runs
      // inside the same lock, right after the wallet write commits, so two
      // concurrent equips can't land their room-state writes out of order and
      // leave the displayed body a step behind the wallet. It's wrapped in its
      // own try/catch: the wallet write is the source of truth, and a
      // room-write failure must not turn a committed equip into a reported
      // failure — that would show an error while the player's real body is
      // already correct, and only reload would fix the mismatch.
      try {
        await $room.updateMyState({ body: result.wallet.equipped });
      } catch {
        // Best-effort — see above.
      }
      return result.wallet.equipped;
    });

    return { ok: !!equipped };
  }

  /**
   * Hot path — called at ~10Hz per client with { throttle }.
   *
   * Reads the previous state before writing, unlike most of this file's
   * setters: a reported position further than physically possible since the
   * last update gets clamped to the reachable radius instead of trusted
   * outright. The client fully owns its own position otherwise (see
   * README's "known limitations"), and `requestShot`'s facing check reads
   * this same `pos` field, so an unvalidated write is exploitable for both
   * movement and the shot's facing check (there is no distance check any
   * more — see canShoot in rules.ts).
   */
  async updateTransform(t: { pos: number[]; rotY: number; pose: number; moving: boolean }): Promise<void> {
    const pos = Array.isArray(t?.pos) ? t.pos : [0, 0, 0];
    const now = Date.now();

    const prev = await $room.getMyState();
    const prevPos = Array.isArray(prev.pos) ? prev.pos : [0, 0, 0];
    const elapsed = Math.min(Math.max(now - num(prev.lastMoveAt, now), MIN_DT_MS), MAX_DT_MS);
    const maxDist = MOVE_SPEED_CAP * SPEED_GRACE * (elapsed / 1000);

    const [x, z] = clampMoveXZ(num(prevPos[0]), num(prevPos[2]), num(pos[0]), num(pos[2]), maxDist);

    await $room.updateMyState({
      pos: [x, num(pos[1]), z],
      rotY: num(t?.rotY),
      pose: Math.max(0, Math.min(POSE_COUNT - 1, Math.floor(num(t?.pose)))),
      moving: !!t?.moving,
      lastMoveAt: now,
    });
  }

  /**
   * Relay a batch of brush dabs to everyone else in the room.
   *
   * Players can only paint their own body, so the sender is implicit and there
   * is nothing to validate for fairness — only size, to bound the message.
   */
  async paintDabs(dabs: Array<{ u: number; v: number; r: number; c: number; j?: boolean }>): Promise<void> {
    if (!Array.isArray(dabs) || !dabs.length) return;

    const clean = dabs.slice(0, PAINT_LIMITS.maxBatch).map((d) => ({
      u: clamp01(d?.u),
      v: clamp01(d?.v),
      r: Math.max(1, Math.min(PAINT_LIMITS.maxRadius, num(d?.r, 8))),
      c: Math.max(0, Math.min(0xffffff, Math.floor(num(d?.c)))),
      j: !!d?.j,
    }));

    await $room.broadcastToRoom("paint", { account: $sender.account, dabs: clean });
  }

  /** FILL tool — one message instead of hundreds of dabs. */
  async paintFill(color: number): Promise<void> {
    await $room.broadcastToRoom("paintFill", {
      account: $sender.account,
      c: Math.max(0, Math.min(0xffffff, Math.floor(num(color)))),
    });
  }

  /**
   * The seeker fires. The client decides whether the shot connected, because
   * only it can see the geometry between the two of them; the server decides
   * whether the shot was legal at all.
   *
   * The decision itself is canShoot() in rules.ts, pure, so check:shot can
   * cover every refusal — the test harness cannot drive a room into the
   * seeking phase to reach any of them from here.
   */
  async requestShot(targetAccount: string): Promise<{ ok: boolean; reason?: ShotFailure }> {
    const state = await $room.getRoomState();

    const users = await $room.getAllUserStates();
    const me = users.find((u) => u.account === $sender.account);
    const bots = syncRoomBots(state.bots, users.length);
    const botTarget = bots.find((b) => b.account === targetAccount) ?? null;
    const target = users.find((u) => u.account === targetAccount) ?? botTarget;
    const now = Date.now();

    // `me` can be legitimately missing right after joinGame (see the "shot is
    // refused outside the seeking phase" test), so its absence must be passed
    // into canShoot rather than papered over here: canShoot's senderMissing
    // check refuses it before seekerPos/seekerRotY/lastShotAt's defaults
    // ([0,0,0], 0, 0) would otherwise be trusted as real state. Those defaults
    // are not neutral — [0,0,0]/yaw 0 is a plausible arena position, and
    // lastShotAt: 0 clears the cooldown outright — so a missing sender must
    // fail closed, not fall through to them.
    const myPos = (me?.pos as number[]) ?? [0, 0, 0];

    const verdict = canShoot({
      phase: String(state.phase ?? "lobby"),
      // state.seeker names only the original seeker. Tag conversions must be
      // authorized from the sender's current room role instead.
      senderIsSeeker: canFireAsSeeker(me),
      senderMissing: !me,
      target,
      seekerPos: myPos,
      seekerRotY: num(me?.rotY),
      now,
      lastShotAt: num(me?.lastShotAt),
    });

    // The shot is recorded and broadcast before the catch is applied, and a
    // refused request broadcasts nothing.
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    await $room.updateMyState({ lastShotAt: now });
    await $room.broadcastToRoom("shot", {
      account: $sender.account,
      // canShoot has already refused senderMissing, so `me` is non-null past
      // this point and the fallback in myPos is unreachable here.
      from: myPos,
      hit: targetAccount,
    });

    // Unchanged from the tag it replaces: same write, same broadcast. Nothing
    // client-side subscribes to "caught" yet, but a later feature might.
    // What a catch DOES is the difference between the two rooms, and it is
    // decided in one place so the two can never drift into a third behaviour.
    const mode: GameMode = isGameMode(state.mode) ? state.mode : DEFAULT_MODE;
    if (botTarget) {
      const nextBots = bots.map((b) =>
        b.account === targetAccount ? { ...b, caught: true, caughtAt: now, spectating: true } : b
      );
      await $global.updateRoomState($sender.roomId, { bots: nextBots });
    } else {
      await $room.updateUserState(targetAccount, catchPatch(mode, now));
    }
    await $room.broadcastToRoom("caught", {
      account: targetAccount,
      by: $sender.account,
      at: now,
      mode,
    });

    return { ok: true };
  }

  /** Phase machine. Runs every 200-1000ms while the room has players. */
  async $roomTick(_deltaMillis: number, roomId: string): Promise<void> {
    const state = await $global.getRoomState(roomId);
    const users = await $global.getRoomUserAccounts(roomId);
    const now = Date.now();

    // Publish the server clock so clients can render an accurate countdown.
    await $global.updateRoomState(roomId, { tickAt: now });

    const phase: Phase = (state.phase as Phase) || "lobby";

    if (users.length === 0) return;

    const userStates: Array<Record<string, any>> = [];
    for (const account of users) {
      const s = await $global.getRoomUserState(roomId, account);
      userStates.push({ ...s, account });
    }

    const bots = syncRoomBots(state.bots, users.length);
    if (JSON.stringify(bots) !== JSON.stringify(state.bots ?? [])) {
      await $global.updateRoomState(roomId, { bots });
    }

    switch (phase) {
      case "lobby": {
        const ready = userStates.filter((u) => u.ready).length;
        if (users.length >= MIN_PLAYERS && ready >= users.length) {
          await startRound(roomId, userStates, state);
        }
        break;
      }

      case "hiding": {
        if (now >= num(state.phaseEndsAt)) {
          // Lift the seeker out of the holding cell. lastMoveAt has to move
          // with the position: updateTransform clamps a report against the
          // distance travelled since that timestamp, so leaving it behind means
          // the server's own teleport reads as a speed hack and gets clamped
          // back toward the cell.
          const seeker = state.seeker as string | undefined;
          // Guard against a seeker who has already left the room: without
          // this, a write to a non-member throws, the tick never advances
          // past `hiding`, and every later tick re-enters this branch and
          // re-throws — the room wedges in the hiding phase forever.
          if (seeker && users.includes(seeker)) {
            await $global.updateRoomUserState(roomId, seeker, {
              pos: HUNT_START,
              lastMoveAt: now,
            });
          }

          await $global.updateRoomState(roomId, {
            phase: "seeking" as Phase,
            phaseEndsAt: now + PHASE_SECONDS.seeking * 1000,
          });
          await $global.broadcastToAll("seekingStart", { roomId });
        }
        break;
      }

      case "seeking": {
        // One rule for both modes — see huntOver in rules.ts. It works for tag
        // precisely because a caught player there changes ROLE rather than
        // setting a flag, so "nobody left to find" is the same sentence.
        const seekerGone = !!state.seeker && !users.includes(state.seeker);
        if (now >= num(state.phaseEndsAt) || huntOver([...userStates, ...bots]) || seekerGone) {
          await endRound(roomId, userStates, state);
        }
        break;
      }

      case "results": {
        if (now >= num(state.phaseEndsAt)) {
          // A room with enough people simply plays again. Anyone who wanted to
          // stop had the whole results phase to press leave, and making
          // everybody re-press ready after every round was a lobby nobody
          // asked to visit. Falling short of MIN_PLAYERS goes back to the
          // lobby rather than starting a round that cannot be played.
          if (afterResults(users.length, MIN_PLAYERS) === "restart") {
            await startRound(roomId, userStates, state);
          } else {
            await $global.updateRoomState(roomId, { phase: "lobby" as Phase, phaseEndsAt: 0 });
            for (const u of userStates) {
              await $global.updateRoomUserState(roomId, u.account, { ready: false });
            }
          }
        }
        break;
      }
    }
  }
}
