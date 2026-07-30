/**
 * Offline development mode.
 *
 * Active only when VITE_AGENT8_VERSE is unset. Mirrors the shape of useGame()
 * exactly so App.tsx doesn't know the difference, and runs the same phase
 * machine and scoring rules as server/src/server.ts, solo.
 *
 * This is a rehearsal rig, not a game mode — nothing here ships to players.
 * It used to also drive a couple of AI bots so a hider/seeker round could be
 * rehearsed either way. That's gone: an AI can never be the seeker, and a bot
 * that sometimes got picked as seeker would break that rule in the one place
 * it could actually happen — online rooms only ever hold real players, so
 * this offline rig was it. See startRound below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PHASE_SECONDS, type Phase } from "../game/constants";
import { randomSpawn } from "../game/map";
import { surfaceFor } from "../game/paint";
import { BODIES, DEFAULT_BODY_ID } from "../game/bodies";
import type { BuyResult, LeaderboardResult, PlayerState, RoomInfo, WalletView, WireDab } from "./types";

const ME = "local-player";

export function useOfflineGame() {
  const [joined, setJoined] = useState(false);
  /** Which world we're standing in. Mirrors the server's room `kind`. */
  const [scene, setScene] = useState<"hub" | "game">("hub");
  const [nick, setNick] = useState("나");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [phaseEndsAt, setPhaseEndsAt] = useState(0);
  const [round, setRound] = useState(0);
  const [seeker, setSeeker] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [lastResults, setLastResults] = useState<any[] | null>(null);
  const [ready, setReadyState] = useState(false);
  // My own transform lives in a ref, so the player list has to be rebuilt on
  // this counter or the scene renders a stale snapshot.
  const [tick, forceTick] = useState(0);

  /**
   * Rehearsal-only wallet. 100 coins is chosen, not arbitrary: it buys the two
   * cheapest avatars exactly and leaves the most expensive out of reach, so
   * both the successful purchase and the insufficient-funds refusal can be
   * exercised without a server. Resets on reload — offline mode is a rig, not
   * a save file. Nothing here exists on the server: granting coins over the
   * wire would let anyone set their own balance.
   */
  const [wallet, setWallet] = useState<WalletView>({
    coins: 100,
    owned: [DEFAULT_BODY_ID],
    equipped: DEFAULT_BODY_ID,
  });

  const myPos = useRef<[number, number, number]>([0, 0, 0]);
  const myRot = useRef(0);
  const myPose = useRef(0);
  const caught = useRef(false);
  const caughtAt = useRef<number | null>(null);

  const startRound = useCallback(() => {
    // Solo rehearsal: you are always the seeker. That is not a shortcut — an AI
    // seeker is explicitly not allowed, and with nobody else in the room there is
    // no one else it could be. The cost is that hiding can't be practised
    // offline.
    setSeeker(ME);
    setRound((r) => r + 1);
    setPhase("hiding");
    setPhaseEndsAt(Date.now() + PHASE_SECONDS.hiding * 1000);
    setLastResults(null);

    caught.current = false;
    caughtAt.current = null;
    myPos.current = randomSpawn();
    surfaceFor(ME).clear();
  }, []);

  const endRound = useCallback(() => {
    const now = Date.now();

    // Solo rehearsal: you're always the seeker, and with nobody else in the
    // room there's never anyone to catch. The result row still comes out in
    // the same shape the server uses, just with nothing to score.
    const gained = 0;
    const next = { ...scores, [ME]: (scores[ME] ?? 0) + gained };
    const results = [{ account: ME, nick, caught: false, gained, seeker: true }];

    setScores(next);
    setLastResults(results);
    setPhase("results");
    setPhaseEndsAt(now + PHASE_SECONDS.results * 1000);
  }, [scores, nick]);

  // Phase machine, at roughly the cadence of $roomTick. This keeps running for
  // a lone player because it's the only thing that puts the seeker in the
  // holding cell and teleports them out on the phase change — the server test
  // harness can't drive that on screen, only this rig can.
  useEffect(() => {
    if (!joined || scene !== "game") return;

    const id = setInterval(() => {
      const now = Date.now();

      if (phase === "lobby") {
        if (ready) startRound();
      } else if (phase === "hiding" && now >= phaseEndsAt) {
        setPhase("seeking");
        setPhaseEndsAt(now + PHASE_SECONDS.seeking * 1000);
      } else if (phase === "seeking") {
        // Nobody else is ever in the room, so seeking can only end on the
        // clock — there's no hider left to catch early.
        if (now >= phaseEndsAt) endRound();
      } else if (phase === "results" && now >= phaseEndsAt) {
        setPhase("lobby");
        setPhaseEndsAt(0);
        setReadyState(false);
      }

      if (import.meta.env.DEV) {
        (window as any).__pcDebug = {
          phase,
          phaseEndsAt,
          secondsLeftNow: Math.max(0, Math.ceil((phaseEndsAt - now) / 1000)),
          tickWrites: ((window as any).__pcDebug?.tickWrites ?? 0) + 1,
          seeker,
          myPos: myPos.current,
          myCaught: caught.current,
        };
      }

      forceTick((n) => n + 1);
    }, 200);

    return () => clearInterval(id);
  }, [joined, scene, phase, phaseEndsAt, ready, seeker, startRound, endRound]);

  const players: PlayerState[] = useMemo(() => {
    if (scene === "hub") {
      return [{ account: ME, nick, pos: myPos.current, rotY: myRot.current, pose: 0, moving: false }];
    }

    const mine: PlayerState = {
      account: ME,
      nick,
      ready,
      role: seeker === ME ? "seeker" : "hider",
      caught: caught.current,
      caughtAt: caughtAt.current,
      pos: myPos.current,
      rotY: myRot.current,
      pose: myPose.current,
      moving: false,
    };
    return [mine];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nick, ready, seeker, phase, round, tick, scene]);

  const room: RoomInfo | null = !joined
    ? null
    : scene === "hub"
    ? {
        kind: "hub",
        phase: "lobby",
        phaseEndsAt: 0,
        tickAt: Date.now(),
        round: 0,
        seeker: null,
        scores,
        lastResults: null,
      }
    : { kind: "game", phase, phaseEndsAt, tickAt: Date.now(), round, seeker, scores, lastResults };

  const secondsLeft = phaseEndsAt ? Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000)) : 0;

  return {
    server: {
      remoteFunction: async (fn: string, args: any[] = []) => {
        if (fn === "updateTransform") {
          const t = args[0] ?? {};
          myPos.current = (t.pos as [number, number, number]) ?? myPos.current;
          myRot.current = t.rotY ?? 0;
          myPose.current = t.pose ?? 0;
        }
        return null;
      },
      onRoomMessage: () => () => {},
    } as any,
    account: ME,
    connected: true,
    joined,
    joining: false,
    error: null,
    room,
    me: players[0] ?? null,
    players,
    secondsLeft,
    join: async (n: string) => {
      setNick(n || "나");
      setJoined(true);
      setScene("hub");
      myPos.current = [0, 0, 10];
    },
    enterGame: async () => {
      setScene("game");
      setPhase("lobby");
      setPhaseEndsAt(0);
      setReadyState(false);
      myPos.current = randomSpawn();
    },
    returnToHub: async () => {
      setScene("hub");
      setPhase("lobby");
      setPhaseEndsAt(0);
      setReadyState(false);
      myPos.current = [0, 0, 10];
    },
    setReady: (r: boolean) => {
      setReadyState(r);
      return Promise.resolve();
    },
    // Our own dabs are already drawn locally by LocalPlayer; with no peers to
    // notify, these are no-ops offline.
    paintDabs: (_dabs: WireDab[]) => Promise.resolve(),
    paintFill: (_color: number) => Promise.resolve(),
    requestTag: async (_target: string) => {
      // Solo rehearsal: nobody else is ever in the room, so there's never a
      // valid tag target.
      return { ok: false };
    },
    fetchLeaderboard: async (): Promise<LeaderboardResult> => {
      const ranked = Object.entries(scores)
        .map(([account, total]) => ({ account, nick: account === ME ? nick : "익명", total }))
        .sort((a, b) => b.total - a.total)
        .map((e, i) => ({ ...e, rank: i + 1 }));

      const top = ranked.slice(0, 10);
      if (top.some((e) => e.account === ME)) return { top, me: null };
      return { top, me: ranked.find((e) => e.account === ME) ?? null };
    },
    fetchWallet: async (): Promise<WalletView> => wallet,

    buyAvatar: async (id: string): Promise<BuyResult> => {
      const profile = BODIES.find((b) => b.id === id);
      if (!profile) return { ok: false, reason: "unknown" };
      if (wallet.owned.includes(id)) return { ok: false, reason: "owned" };
      if (wallet.coins < profile.price) return { ok: false, reason: "broke" };

      const next: WalletView = {
        coins: wallet.coins - profile.price,
        owned: [...wallet.owned, id],
        equipped: wallet.equipped,
      };
      setWallet(next);
      return { ok: true, wallet: next };
    },

    equipAvatar: async (id: string): Promise<{ ok: boolean }> => {
      if (!wallet.owned.includes(id)) return { ok: false };
      setWallet((w) => ({ ...w, equipped: id }));
      return { ok: true };
    },
  };
}
