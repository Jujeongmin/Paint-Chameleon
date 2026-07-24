import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useGameServer,
  useRoomState,
  useRoomMyState,
  useRoomAllUserStates,
} from "@agent8/gameserver";
import type { Phase } from "../game/constants";
import { surfaceFor } from "../game/paint";
import type { LeaderboardResult, PlayerState, RoomInfo, WireDab } from "./types";
import { useOfflineGame } from "./offline";

export type { LeaderboardResult, PlayerState, RoomInfo, RankedLeaderboardEntry, WireDab } from "./types";

/**
 * True when no verse is configured — i.e. running `npm run dev` locally rather
 * than a deployed build. Read once at module scope so the hook branch below is
 * fixed for the lifetime of the page.
 */
const OFFLINE = !import.meta.env.VITE_AGENT8_VERSE;

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

    return () => {
      offPaint?.();
      offFill?.();
    };
  }, [server, roomId, account]);

  const room: RoomInfo | null = useMemo(() => {
    if (!rawRoom || !rawRoom.roomId) return null;
    return {
      kind: rawRoom.kind === "hub" ? "hub" : "game",
      phase: (rawRoom.phase as Phase) || "lobby",
      phaseEndsAt: rawRoom.phaseEndsAt || 0,
      tickAt: rawRoom.tickAt || 0,
      round: rawRoom.round || 0,
      seeker: rawRoom.seeker ?? null,
      scores: rawRoom.scores || {},
      lastResults: rawRoom.lastResults ?? null,
    };
  }, [rawRoom]);

  const players: PlayerState[] = useMemo(
    () => (Array.isArray(rawAll) ? (rawAll as PlayerState[]).filter((p) => p && p.account) : []),
    [rawAll]
  );

  const me: PlayerState | null = (rawMine as PlayerState) ?? null;

  const secondsLeft = room?.phaseEndsAt
    ? Math.max(0, Math.ceil((room.phaseEndsAt - (Date.now() + clockOffset.current)) / 1000))
    : 0;

  const call = useCallback(
    async (fn: string, nick: string, failure: string) => {
      if (!connected || joining) return;
      setJoining(true);
      setError(null);
      try {
        await server.remoteFunction(fn, [nick]);
        setJoined(true);
      } catch (e: any) {
        setError(e?.message ?? failure);
      } finally {
        setJoining(false);
      }
    },
    [connected, joining, server]
  );

  /** Everyone lands in the hub first; matches start from a portal inside it. */
  const join = useCallback(
    (nick: string) => call("joinHub", nick, "입장에 실패했습니다"),
    [call]
  );

  const enterGame = useCallback(
    (nick: string) => call("joinGame", nick, "매칭에 실패했습니다"),
    [call]
  );

  const returnToHub = useCallback(
    (nick: string) => call("returnToHub", nick, "로비로 돌아가지 못했습니다"),
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

  const requestTag = useCallback(
    (target: string) => server.remoteFunction("requestTag", [target]),
    [server]
  );

  const fetchLeaderboard = useCallback(
    () => server.remoteFunction("getLeaderboard", []) as Promise<LeaderboardResult>,
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
    requestTag,
    fetchLeaderboard,
  };
}
