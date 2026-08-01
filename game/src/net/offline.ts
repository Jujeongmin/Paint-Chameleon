/**
 * Offline development mode.
 *
 * Active only when VITE_AGENT8_VERSE is unset. Mirrors the shape of useGame()
 * exactly so App.tsx doesn't know the difference, and runs the same phase
 * machine and scoring rules as server/src/server.ts, solo.
 *
 * This is a rehearsal rig, not a game mode — nothing here ships to players.
 *
 * It drives AI HIDERS, and only hiders. The seventh session deleted the bots
 * entirely because an AI may never be the seeker and a bot in the draw could be
 * picked as one — this rig being the only place in the project where that could
 * happen, since online rooms hold real people. They are back on the one footing
 * that keeps the rule true by construction: `startRound` assigns the seeker to
 * you unconditionally, and a BotState has no role field to be assigned. What
 * that buys back is the thing the deletion cost — somebody to hunt, so the gun,
 * cover, catching, the results reveal and coin payout can all be rehearsed
 * solo. See game/src/game/bot.ts, and check:bot for what is actually pinned.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PHASE_SECONDS, type Phase } from "../game/constants";
import { MAP_BOXES, randomSpawn } from "../game/map";
import { CELL_SPAWN, HUNT_START } from "../game/cell";
import { surfaceFor } from "../game/paint";
import { BODIES, DEFAULT_BODY_ID } from "../game/bodies";
import { botIsOut, createBots, resetBots, stepBots, type BotState } from "../game/bot";
import { DEFAULT_MODE, type GameMode } from "../game/modes";
import { coinsFor } from "../game/coins";
import { t, type Key } from "../ui/i18n";
import type { BuyResult, LeaderboardResult, PlayerState, RoomInfo, WalletView, WireDab } from "./types";

const ME = "local-player";

export function useOfflineGame() {
  const [joined, setJoined] = useState(false);
  /** Which world we're standing in. Mirrors the server's room `kind`. */
  const [scene, setScene] = useState<"hub" | "game">("hub");
  const [nick, setNick] = useState(() => t("app.defaultNick"));
  const [mode, setMode] = useState<GameMode>(DEFAULT_MODE);
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

  /**
   * The bots. A ref, not state: they move every frame and re-rendering React
   * sixty times a second to say so would cost more than the whole rig. The
   * phase machine's tick is what publishes them into `players`.
   */
  const bots = useRef<BotState[]>(createBots());
  /** Paint already applied, so a fill only runs when a bot changes its mind. */
  const botPaint = useRef<Map<string, number>>(new Map());

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
    // Fresh hiders every round, back at their spawns with nothing painted on.
    resetBots(bots.current);
    for (const bot of bots.current) surfaceFor(bot.account).clear();
    botPaint.current.clear();
    // Mirrors startRound in server/src/server.ts: the seeker (always you,
    // here) starts in the holding cell, not an arena spawn.
    myPos.current = [...CELL_SPAWN] as [number, number, number];
    surfaceFor(ME).clear();
  }, []);

  const endRound = useCallback(() => {
    const now = Date.now();

    // You are always the seeker here, so your payout is the catch payout. The
    // bots are scored as hiders on the same function the server uses, which is
    // what makes this rig able to rehearse the results screen and the coin
    // grant at all — before the bots existed there was never anything to score.
    const caughtBots = bots.current.filter((b) => b.caught).length;
    const gained = coinsFor({ seeker: true, caught: false, catches: caughtBots });
    const next = { ...scores, [ME]: (scores[ME] ?? 0) + gained };
    const results = [
      { account: ME, nick, caught: false, gained, seeker: true },
      ...bots.current.map((b) => ({
        account: b.account,
        nick: t(b.nameKey as Key),
        caught: b.caught,
        gained: coinsFor({ seeker: false, caught: b.caught, catches: 0 }),
        seeker: false,
      })),
    ];

    setWallet((w) => ({ ...w, coins: w.coins + gained }));
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
        // Mirrors the hiding case in server/src/server.ts's $roomTick: lift
        // the seeker out of the cell to the arena centre on this transition.
        myPos.current = [...HUNT_START] as [number, number, number];
        setPhase("seeking");
        setPhaseEndsAt(now + PHASE_SECONDS.seeking * 1000);
      } else if (phase === "seeking") {
        // Ends on the clock, or the moment the last hider is caught — the same
        // two ways the server ends it.
        if (now >= phaseEndsAt || bots.current.every((b) => b.caught)) endRound();
      } else if (phase === "results" && now >= phaseEndsAt) {
        // Straight into another round, as the server now does — the lobby is
        // where you go to stop, and leaving is a button rather than a phase.
        startRound();
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

  /**
   * The bots' own clock, at animation rate.
   *
   * Deliberately NOT the 200ms phase tick below. That tick exists to imitate
   * the server's ~10Hz state broadcast, and a physics step of 0.2s would make
   * the bots lurch a whole metre at a time through collision that was written
   * for sixteen-millisecond steps. So they think at frame rate and are
   * PUBLISHED at tick rate, which is exactly the split a real player has —
   * RemotePlayers interpolates them the same way it interpolates a person.
   */
  useEffect(() => {
    if (!joined || scene !== "game") return;
    if (phase !== "hiding" && phase !== "seeking") return;

    let raf = 0;
    let last = performance.now();

    const frame = (t: number) => {
      const dt = Math.min(0.05, Math.max(1 / 240, (t - last) / 1000));
      last = t;

      stepBots(
        bots.current,
        {
          boxes: MAP_BOXES,
          // The seeker is underground during the hiding phase, so nobody can
          // be spooked by them yet. Passing their cell position instead would
          // have every bot fleeing a threat 8 metres below the floor.
          seeker: phase === "seeking" ? myPos.current : null,
          phase,
          now: t,
        },
        dt
      );

      // Paint is the one thing the brain cannot do itself — it decides on a
      // colour, and the canvas work happens here. Only on a change, or this
      // would repaint four textures every frame.
      for (const bot of bots.current) {
        if (bot.paint === null) continue;
        if (botPaint.current.get(bot.account) === bot.paint) continue;
        botPaint.current.set(bot.account, bot.paint);
        surfaceFor(bot.account).fill(bot.paint);
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [joined, scene, phase]);

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

    // Bots only exist inside a round. In the lobby they are still standing at
    // last round's spots, and showing them there would say the round had
    // already started.
    if (phase === "lobby") return [mine];

    return [
      mine,
      ...bots.current.map(
        (b): PlayerState => ({
          account: b.account,
          nick: t(b.nameKey as Key),
          role: "hider",
          caught: b.caught,
          caughtAt: b.caughtAt,
          // A caught bot vanishes in BOTH modes, which is not what the mode
          // rule says for a human and is deliberate.
          //
          // In tag a caught player converts, and a bot cannot: an AI may never
          // be the seeker (bot.ts). So a caught bot is out — and leaving its
          // body lying in the arena said the opposite, since in tag a body on
          // the floor is somebody who is about to get up and hunt you. Removing
          // it is what makes "this one is not coming back" legible.
          spectating: botIsOut(b),
          pos: [...b.motion.pos] as [number, number, number],
          rotY: b.rotY,
          pose: b.pose,
          moving: b.motion.moving,
          body: b.body,
        })
      ),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nick, ready, seeker, phase, round, tick, scene]);

  const room: RoomInfo | null = !joined
    ? null
    : scene === "hub"
    ? {
        kind: "hub",
        mode,
        phase: "lobby",
        phaseEndsAt: 0,
        tickAt: Date.now(),
        round: 0,
        seeker: null,
        scores,
        lastResults: null,
        // Unused in the hub — no round is starting here — but RoomInfo is one
        // shape for both kinds.
        minPlayers: 1,
      }
    : {
        kind: "game",
        mode,
        phase,
        phaseEndsAt,
        tickAt: Date.now(),
        round,
        seeker,
        scores,
        lastResults,
        // Solo rehearsal starts the round with just you — see RoomInfo.
        minPlayers: 1,
      };

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
      setNick(n || t("app.defaultNick"));
      setJoined(true);
      setScene("hub");
      myPos.current = [0, 0, 10];
    },
    enterGame: async (_nick?: string, requested: GameMode = DEFAULT_MODE) => {
      setMode(requested);
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
    requestShot: async (target: string) => {
      // The client already decided the shot connected — it owns hit detection,
      // because it is the only side with a map (see README's known limits). All
      // this has to do is what the server does with that claim: check it is a
      // hider who is still in play, during the hunt, and mark them.
      if (phase !== "seeking") return { ok: false };
      const bot = bots.current.find((b) => b.account === target);
      if (!bot || bot.caught) return { ok: false };
      // A caught bot is OUT, in both modes — it does not convert to a seeker
      // even in tag. That is not an oversight: an AI may never be the seeker
      // (see bot.ts), and a converted bot hunting the others would be exactly
      // that. Tag's conversion is therefore the one rule this rig cannot
      // rehearse; it needs real players.
      bot.caught = true;
      bot.caughtAt = Date.now();
      forceTick((n) => n + 1);
      return { ok: true };
    },
    fetchLeaderboard: async (): Promise<LeaderboardResult> => {
      const ranked = Object.entries(scores)
        .map(([account, total]) => ({ account, nick: account === ME ? nick : t("app.anon"), total }))
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
