import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useGameServer,
  useRoomState,
  useRoomMyState,
  useRoomAllUserStates,
} from "@agent8/gameserver";
import { MIN_PLAYERS, type Phase } from "../game/constants";
import { DEFAULT_MODE, modeOf, type GameMode } from "../game/modes";
import { surfaceFor } from "../game/paint";
import { playShot, shotGainFor } from "../audio/sound";
import type {
  AdClaimResult,
  AdStartResult,
  LeaderboardResult,
  PlayerState,
  RoomInfo,
  WireDab,
  WalletView,
  BuyResult,
} from "./types";
import { useOfflineGame } from "./offline";
import { t, type Key } from "../ui/i18n";

export type { LeaderboardResult, PlayerState, RoomInfo, RankedLeaderboardEntry, WireDab, WalletView, BuyResult, BuyFailure } from "./types";

/**
 * True when no verse is configured — i.e. running `npm run dev` locally rather
 * than a deployed build. Read once at module scope so the hook branch below is
 * fixed for the lifetime of the page.
 */
const OFFLINE = !import.meta.env.VITE_AGENT8_VERSE;
/** A broken socket response must return control to the join button. */
export const REMOTE_CALL_TIMEOUT_MS = 12_000;
/** Room subscriptions can fail independently after the join RPC succeeds. */
export const ROOM_STATE_TIMEOUT_MS = 12_000;

/** Picks the real Agent8-backed game or the local rehearsal rig. */
export function useGame() {
  return OFFLINE ? useOfflineGame() : useOnlineGame();
}

/**
 * Wraps the Agent8 room hooks into one game-shaped view, and keeps a
 * server-clock offset so the countdown doesn't drift with the client clock.
 */
function useOnlineGame() {
  const { server, account, connected } = useGameServer();
  const rawRoom = useRoomState() as any;
  const rawMine = useRoomMyState() as any;
  const rawAll = useRoomAllUserStates() as any[];

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clockOffset = useRef(0);

  // Re-render once a second so the phase countdown ticks down smoothly.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof rawRoom?.tickAt === "number" && rawRoom.tickAt > 0) {
      clockOffset.current = rawRoom.tickAt - Date.now();
    }
  }, [rawRoom?.tickAt]);

  const roomId: string | undefined = rawRoom?.roomId;

  // Read from a ref inside the "shot" handler below rather than putting
  // rawMine?.pos in that effect's deps: pos changes every tick, so a dep on it
  // would tear the subscription down and rebuild it every tick too. This repo
  // has already hit that failure mode once (see HANDOFF) — a value pulled out
  // of `game` landed in an effect's deps, the effect re-ran every render, and
  // the main thread starved until the screen froze. Assigning a ref during
  // render, as latest.current is done in useShoot.ts, keeps the handler
  // reading fresh state without any of that.
  const myPosRef = useRef<number[]>([0, 0, 0]);
  myPosRef.current = Array.isArray(rawMine?.pos) ? (rawMine.pos as number[]) : [0, 0, 0];

  // Replay everyone else's brush strokes onto their own body texture.
  useEffect(() => {
    if (!roomId) return;
    const lastUV = new Map<string, { u: number; v: number }>();

    const offPaint = server.onRoomMessage(roomId, "paint", (msg: any) => {
      if (!msg || msg.account === account) return; // our own dabs already applied locally
      const surface = surfaceFor(msg.account);
      for (const d of (msg.dabs ?? []) as WireDab[]) {
        const previous = lastUV.get(msg.account);
        if (d.j && previous) surface.stroke(previous, d);
        else surface.dab(d);
        lastUV.set(msg.account, { u: d.u, v: d.v });
      }
    });

    const offFill = server.onRoomMessage(roomId, "paintFill", (msg: any) => {
      if (!msg || msg.account === account) return;
      surfaceFor(msg.account).fill(msg.c ?? 0xffffff);
      lastUV.delete(msg.account);
    });

    const offShot = server.onRoomMessage(roomId, "shot", (msg: any) => {
      if (!msg || msg.account === account) return; // our own shot already sounded locally
      const from = Array.isArray(msg.from) ? msg.from : [0, 0, 0];
      const mine = myPosRef.current;
      const distance = Math.hypot(
        Number(from[0]) - Number(mine[0]),
        Number(from[2]) - Number(mine[2])
      );
      playShot(shotGainFor(distance));
    });

    return () => {
      offPaint?.();
      offFill?.();
      offShot?.();
    };
  }, [server, roomId, account]);

  const room: RoomInfo | null = useMemo(() => {
    if (!rawRoom || !rawRoom.roomId) return null;
    return {
      kind: rawRoom.kind === "hub" ? "hub" : "game",
      mode: modeOf(rawRoom.mode),
      phase: (rawRoom.phase as Phase) || "lobby",
      phaseEndsAt: rawRoom.phaseEndsAt || 0,
      tickAt: rawRoom.tickAt || 0,
      round: rawRoom.round || 0,
      seeker: rawRoom.seeker ?? null,
      scores: rawRoom.scores || {},
      lastResults: rawRoom.lastResults ?? null,
      bots: Array.isArray(rawRoom.bots) ? rawRoom.bots : [],
      // The live server won't start a round below MIN_PLAYERS — see RoomInfo.
      minPlayers: MIN_PLAYERS,
    };
  }, [rawRoom]);

  const players: PlayerState[] = useMemo(() => {
    const humans = Array.isArray(rawAll) ? (rawAll as PlayerState[]).filter((p) => p && p.account) : [];
    if (rawRoom?.kind === "hub") return humans;
    const bots = Array.isArray(rawRoom?.bots)
      ? rawRoom.bots.map((b: PlayerState) => ({
          ...b,
          bot: true,
          nick: b.nameKey ? t(b.nameKey as Key) : b.nick,
        }))
      : [];
    return [...humans, ...bots];
  }, [rawAll, rawRoom?.bots, rawRoom?.kind]);

  const me: PlayerState | null = (rawMine as PlayerState) ?? null;
  const roomReady = !!rawRoom?.roomId && !!rawMine?.account;

  useEffect(() => {
    if (roomReady) {
      setJoined(true);
      setError(null);
      return;
    }
    if (!joined) return;

    const timeout = setTimeout(() => {
      setJoined(false);
      setError(t("error.join"));
    }, ROOM_STATE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [joined, roomReady]);

  const secondsLeft = room?.phaseEndsAt
    ? Math.max(0, Math.ceil((room.phaseEndsAt - (Date.now() + clockOffset.current)) / 1000))
    : 0;

  const call = useCallback(
    async (fn: string, args: string | unknown[], failure: string) => {
      if (!connected || joining) return;
      setJoining(true);
      setError(null);
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          server.remoteFunction(fn, Array.isArray(args) ? args : [args]),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error(failure)), REMOTE_CALL_TIMEOUT_MS);
          }),
        ]);
        setJoined(true);
      } catch (e: any) {
        setError(e?.message ?? failure);
      } finally {
        if (timeout) clearTimeout(timeout);
        setJoining(false);
      }
    },
    [connected, joining, server]
  );

  /** Everyone lands in the hub first; matches start from a portal inside it. */
  const join = useCallback(
    (nick: string) => call("joinHub", nick, t("error.join")),
    [call]
  );

  const enterGame = useCallback(
    (nick: string, mode: GameMode = DEFAULT_MODE) =>
      call("joinGame", [nick, mode], t("error.match")),
    [call]
  );

  const returnToHub = useCallback(
    (nick: string) => call("returnToHub", nick, t("error.hub")),
    [call]
  );

  const setReady = useCallback(
    (ready: boolean) => server.remoteFunction("setReady", [ready], { needResponse: false }),
    [server]
  );

  const paintDabs = useCallback(
    (dabs: WireDab[]) =>
      server.remoteFunction("paintDabs", [dabs], { needResponse: false }).catch(() => {}),
    [server]
  );

  const paintFill = useCallback(
    (color: number) =>
      server.remoteFunction("paintFill", [color], { needResponse: false }).catch(() => {}),
    [server]
  );

  const requestShot = useCallback(
    (target: string) => server.remoteFunction("requestShot", [target]),
    [server]
  );

  const fetchLeaderboard = useCallback(
    () => server.remoteFunction("getLeaderboard", []) as Promise<LeaderboardResult>,
    [server]
  );

  const fetchWallet = useCallback(
    async (): Promise<WalletView> => await server.remoteFunction("getWallet", []),
    [server]
  );

  const buyAvatar = useCallback(
    async (id: string): Promise<BuyResult> => await server.remoteFunction("buyAvatar", [id]),
    [server]
  );

  const equipAvatar = useCallback(
    async (id: string): Promise<{ ok: boolean }> => await server.remoteFunction("equipAvatar", [id]),
    [server]
  );

  // No arguments on either, and that is the design: the client has nothing to
  // say about an ad that the server would be willing to believe.
  const startAdWatch = useCallback(
    async (): Promise<AdStartResult> => await server.remoteFunction("startAdWatch", []),
    [server]
  );

  const claimAdReward = useCallback(
    async (): Promise<AdClaimResult> => await server.remoteFunction("claimAdReward", []),
    [server]
  );

  return {
    server,
    account,
    connected,
    joined,
    joining,
    error,
    room,
    me,
    players,
    secondsLeft,
    join,
    enterGame,
    returnToHub,
    setReady,
    paintDabs,
    paintFill,
    requestShot,
    fetchLeaderboard,
    fetchWallet,
    buyAvatar,
    equipAvatar,
    startAdWatch,
    claimAdReward,
  };
}
