/**
 * Paint Chameleon — authoritative game server.
 *
 * Phase machine runs in $roomTick (200-1000ms). Round deadlines are wall-clock
 * timestamps rather than accumulated deltas so a variable tick rate can't drift.
 * Tag resolution is a remote function, not a tick step, so catches feel instant.
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
  TAG,
  SCORE,
  PAINT_LIMITS,
  MOVE_SPEED_CAP,
  SPEED_GRACE,
  MIN_DT_MS,
  MAX_DT_MS,
  LEADERBOARD_COLLECTION,
  attachRanks,
  randomSpawn,
  type RankedLeaderboardEntry,
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
      pos: isSeeker ? [0, 0, 0] : randomSpawn(),
      rotY: 0,
      lastTagAt: 0,
      lastMoveAt: now,
    });
  }

  await $global.updateRoomState(roomId, {
    phase: "hiding" as Phase,
    round: num(state.round) + 1,
    seeker,
    seekerHistory: [...history, seeker].slice(-12),
    phaseEndsAt: now + PHASE_SECONDS.hiding * 1000,
    lastResults: null,
  });

  // Everyone starts each round unpainted.
  await $global.broadcastToAll("roundStart", { roomId, seeker });
}

async function endRound(roomId: string, users: Array<Record<string, any>>, state: Record<string, any>) {
  const now = Date.now();
  const scores: Record<string, number> = { ...(state.scores || {}) };
  const results: Array<Record<string, any>> = [];
  const seekingStartedAt = num(state.phaseEndsAt) - PHASE_SECONDS.seeking * 1000;

  let catches = 0;

  for (const u of users) {
    if (u.role === "seeker") continue;

    let gained: number;
    if (u.caught) {
      catches++;
      const aliveMs = Math.max(0, num(u.caughtAt, now) - seekingStartedAt);
      gained = Math.round((aliveMs / 1000) * SCORE.hiderPerSecondAlive);
    } else {
      gained = SCORE.hiderSurvived;
    }

    scores[u.account] = (scores[u.account] || 0) + gained;
    results.push({ account: u.account, nick: u.nick, caught: !!u.caught, gained });
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
  // collection outlives the room, so every entry needs a real one. This runs
  // after the phase transition above and never lets a failure escape: the
  // round must always be able to end even if a leaderboard write doesn't —
  // it's a non-critical, best-effort panel that re-polls on its own.
  for (const r of results) {
    const nick = r.seeker ? users.find((u) => u.account === r.account)?.nick ?? "" : r.nick;
    try {
      await upsertLeaderboard(r.account, nick, r.gained);
    } catch {
      // Best-effort — a transient collection-write failure must not corrupt
      // or re-trigger this round's results, which have already been published.
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

// ------------------------------------------------------------------- server

export class Server {
  /**
   * Enter the social hub. Everyone lands here first; matches are started from
   * a portal inside it.
   */
  async joinHub(nick: string): Promise<{ roomId: string }> {
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

    const state = await $global.getRoomState(roomId);
    if (state.kind !== "hub") {
      await $global.updateRoomState(roomId, { kind: "hub" as RoomKind, phase: null });
    }

    await $global.updateRoomUserState(roomId, $sender.account, {
      nick: sanitizeNick(nick),
      pos: [(Math.random() - 0.5) * 6, 0, 8 + Math.random() * 3],
      rotY: Math.PI,
      pose: 0,
      moving: false,
      lastMoveAt: Date.now(),
    });

    return { roomId };
  }

  /** Join an open lobby, or open a new one. Returns the room id. */
  async joinGame(nick: string): Promise<{ roomId: string }> {
    // Leave the hub first — a player is only ever in one room.
    if ($sender.roomId) await $global.leaveRoom();

    const roomId = await $lock("matchmaking", async () => {
      const states = await $global.getAllRoomStates();
      let target: string | undefined;
      for (const s of states) {
        // Opt in, don't opt out: a room with no kind yet (or a hub, whose phase
        // is null and would read as "lobby") must never absorb a match.
        if (s.kind !== "game") continue;
        const count = Array.isArray(s.$users) ? s.$users.length : 0;
        if ((s.phase || "lobby") === "lobby" && count < MAX_PLAYERS) {
          target = s.roomId;
          break;
        }
      }
      return await $global.joinRoom(target);
    });

    const state = await $global.getRoomState(roomId);
    if (!state.phase) {
      await $global.updateRoomState(roomId, {
        kind: "game" as RoomKind,
        phase: "lobby" as Phase,
        round: 0,
        seeker: null,
        seekerHistory: [],
        scores: {},
        phaseEndsAt: 0,
        lastResults: null,
      });
    }

    await $global.updateRoomUserState(roomId, $sender.account, {
      nick: sanitizeNick(nick),
      ready: false,
      role: "hider",
      caught: false,
      caughtAt: null,
      pos: randomSpawn(),
      rotY: 0,
      pose: 0,
      moving: false,
      lastTagAt: 0,
      lastMoveAt: Date.now(),
    });

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
    await $room.updateMyState({ ready: !!ready });
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

  /**
   * Hot path — called at ~10Hz per client with { throttle }.
   *
   * Reads the previous state before writing, unlike most of this file's
   * setters: a reported position further than physically possible since the
   * last update gets clamped to the reachable radius instead of trusted
   * outright. The client fully owns its own position otherwise (see
   * README's "known limitations"), and `requestTag`'s distance check reads
   * this same `pos` field, so an unvalidated write is exploitable for both
   * movement and tagging.
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

  /** Seeker requests a catch. Server owns the decision. */
  async requestTag(targetAccount: string): Promise<{ ok: boolean; reason?: string }> {
    const state = await $room.getRoomState();
    if (state.phase !== "seeking") return { ok: false, reason: "not_seeking" };
    if (state.seeker !== $sender.account) return { ok: false, reason: "not_seeker" };

    const users = await $room.getAllUserStates();
    const me = users.find((u) => u.account === $sender.account);
    const target = users.find((u) => u.account === targetAccount);
    if (!me || !target) return { ok: false, reason: "missing" };
    if (target.role !== "hider" || target.caught) return { ok: false, reason: "invalid_target" };

    const now = Date.now();
    if (now - num(me.lastTagAt) < TAG.cooldownMs) return { ok: false, reason: "cooldown" };

    const a = me.pos || [0, 0, 0];
    const b = target.pos || [0, 0, 0];
    const dx = num(b[0]) - num(a[0]);
    const dz = num(b[2]) - num(a[2]);
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > TAG.maxDistance) return { ok: false, reason: "too_far" };

    // Seeker must actually be looking at the target.
    const len = dist || 1;
    const fx = Math.sin(num(me.rotY));
    const fz = Math.cos(num(me.rotY));
    if ((dx / len) * fx + (dz / len) * fz < TAG.minFacingDot) {
      return { ok: false, reason: "not_facing" };
    }

    await $room.updateMyState({ lastTagAt: now });
    await $room.updateUserState(targetAccount, { caught: true, caughtAt: now });
    await $room.broadcastToRoom("caught", { account: targetAccount, by: $sender.account, at: now });

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
          await $global.updateRoomState(roomId, {
            phase: "seeking" as Phase,
            phaseEndsAt: now + PHASE_SECONDS.seeking * 1000,
          });
          await $global.broadcastToAll("seekingStart", { roomId });
        }
        break;
      }

      case "seeking": {
        const hiders = userStates.filter((u) => u.role === "hider");
        const allCaught = hiders.length > 0 && hiders.every((u) => u.caught);
        const seekerGone = !!state.seeker && !users.includes(state.seeker);
        if (now >= num(state.phaseEndsAt) || allCaught || seekerGone) {
          await endRound(roomId, userStates, state);
        }
        break;
      }

      case "results": {
        if (now >= num(state.phaseEndsAt)) {
          await $global.updateRoomState(roomId, { phase: "lobby" as Phase, phaseEndsAt: 0 });
          for (const u of userStates) {
            await $global.updateRoomUserState(roomId, u.account, { ready: false });
          }
        }
        break;
      }
    }
  }
}
