/**
 * Offline development mode.
 *
 * Active only when VITE_AGENT8_VERSE is unset. Mirrors the shape of useGame()
 * exactly so App.tsx doesn't know the difference, and runs the same phase
 * machine and scoring rules as server/src/server.ts against local bots.
 *
 * This is a rehearsal rig, not a game mode — nothing here ships to players.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PHASE_SECONDS, SCORE, TAG, type Phase } from "../game/constants";
import { MAP_BOXES, randomSpawn, resolveMove } from "../game/map";
import { surfaceFor } from "../game/paint";
import type { PlayerState, RoomInfo, WireDab } from "./types";

const ME = "local-player";
const BOTS = [
  { account: "bot-mina", nick: "미나" },
  { account: "bot-jun", nick: "준" },
];

/** Bots paint themselves the colour of whatever they're hiding next to. */
function nearestSurfaceColor(x: number, z: number): number {
  let best = 0x8a8f99;
  let bestD = Infinity;
  for (const b of MAP_BOXES) {
    const dx = Math.max(0, Math.abs(x - b.p[0]) - b.s[0] / 2);
    const dz = Math.max(0, Math.abs(z - b.p[2]) - b.s[2] / 2);
    const d = Math.hypot(dx, dz);
    if (d < bestD) {
      bestD = d;
      best = b.c;
    }
  }
  return best;
}

interface Bot extends PlayerState {
  target: [number, number, number];
  /** Seconds spent making no progress against geometry. */
  stuck?: number;
  /** Heading offset that last got us moving; retried first to avoid dithering. */
  avoidAngle?: number;
  /** Temporary waypoint that overrides the normal goal while unwedging. */
  detour?: [number, number];
  detourUntil?: number;
  /** Debug only. */
  goal?: [number, number];
  goalDist?: number;
}

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
  // Bots and my own transform live in refs, so the player list has to be rebuilt
  // on this counter or the scene renders a stale snapshot.
  const [tick, forceTick] = useState(0);

  const myPos = useRef<[number, number, number]>([0, 0, 0]);
  const myRot = useRef(0);
  const myPose = useRef(0);
  const caught = useRef(false);
  const caughtAt = useRef<number | null>(null);
  const bots = useRef<Bot[]>([]);

  const startRound = useCallback(() => {
    const all = [ME, ...BOTS.map((b) => b.account)];
    const nextSeeker = all[(round + 1) % all.length];
    setSeeker(nextSeeker);
    setRound((r) => r + 1);
    setPhase("hiding");
    setPhaseEndsAt(Date.now() + PHASE_SECONDS.hiding * 1000);
    setLastResults(null);

    caught.current = false;
    caughtAt.current = null;
    myPos.current = randomSpawn();
    surfaceFor(ME).clear();

    bots.current = BOTS.map((b) => {
      const spawn = randomSpawn();
      const isSeeker = b.account === nextSeeker;

      const surface = surfaceFor(b.account);
      surface.clear();
      if (!isSeeker) surface.fill(nearestSurfaceColor(spawn[0], spawn[2]));

      return {
        account: b.account,
        nick: b.nick,
        role: isSeeker ? "seeker" : "hider",
        caught: false,
        caughtAt: null,
        pos: spawn,
        rotY: Math.random() * Math.PI * 2,
        pose: isSeeker ? 0 : 1 + Math.floor(Math.random() * 3),
        moving: false,
        target: randomSpawn(),
      };
    });
  }, [round]);

  const endRound = useCallback(() => {
    const now = Date.now();
    const seekingStart = phaseEndsAt - PHASE_SECONDS.seeking * 1000;
    const results: any[] = [];
    const next = { ...scores };
    let catches = 0;

    const score = (account: string, nickname: string, isCaught: boolean, at: number | null) => {
      let gained: number;
      if (isCaught) {
        catches++;
        gained = Math.round(Math.max(0, (at ?? now) - seekingStart) / 1000);
      } else {
        gained = SCORE.hiderSurvived;
      }
      next[account] = (next[account] ?? 0) + gained;
      results.push({ account, nick: nickname, caught: isCaught, gained });
    };

    if (seeker !== ME) score(ME, nick, caught.current, caughtAt.current);
    for (const b of bots.current) {
      if (b.role === "seeker") continue;
      score(b.account, b.nick ?? "", !!b.caught, b.caughtAt ?? null);
    }
    if (seeker) {
      const gained = catches * SCORE.seekerPerCatch;
      next[seeker] = (next[seeker] ?? 0) + gained;
      results.push({ account: seeker, nick: "", caught: false, gained, seeker: true });
    }

    setScores(next);
    setLastResults(results);
    setPhase("results");
    setPhaseEndsAt(now + PHASE_SECONDS.results * 1000);
  }, [phaseEndsAt, scores, seeker, nick]);

  // Phase machine + bot AI, at roughly the cadence of $roomTick.
  useEffect(() => {
    if (!joined || scene !== "game") return;
    let last = Date.now();

    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;

      if (phase === "lobby") {
        if (ready) startRound();
      } else if (phase === "hiding" && now >= phaseEndsAt) {
        setPhase("seeking");
        setPhaseEndsAt(now + PHASE_SECONDS.seeking * 1000);
      } else if (phase === "seeking") {
        const hiders = bots.current.filter((b) => b.role === "hider");
        const allCaught = (seeker === ME || caught.current) && hiders.every((b) => b.caught);
        if (now >= phaseEndsAt || allCaught) endRound();
      } else if (phase === "results" && now >= phaseEndsAt) {
        setPhase("lobby");
        setPhaseEndsAt(0);
        setReadyState(false);
      }

      // --- bots
      for (const b of bots.current) {
        if (b.caught) continue;
        const isSeeking = phase === "seeking";
        const hunting = b.role === "seeker" && isSeeking;

        if (b.role === "hider" && isSeeking) {
          b.moving = false;
          continue; // hiders freeze once the hunt is on
        }
        if (b.role === "seeker" && phase === "hiding") {
          b.moving = false;
          continue;
        }

        let [tx, , tz] = b.target;

        // A detour overrides both wandering and hunting: it's what frees a bot
        // that geometry has boxed in, and a hunter would otherwise keep
        // re-selecting the target that walked it into the wall.
        if (b.detour && b.detourUntil && now < b.detourUntil) {
          tx = b.detour[0];
          tz = b.detour[1];
        } else if (hunting) {
          let bestD = Infinity;
          const candidates: [number, number][] = [];
          if (!caught.current && seeker !== ME) candidates.push([myPos.current[0], myPos.current[2]]);
          for (const o of bots.current) {
            if (o.role === "hider" && !o.caught && o.pos) candidates.push([o.pos[0], o.pos[2]]);
          }
          for (const [cx, cz] of candidates) {
            const d = Math.hypot(cx - (b.pos?.[0] ?? 0), cz - (b.pos?.[2] ?? 0));
            if (d < bestD) {
              bestD = d;
              tx = cx;
              tz = cz;
            }
          }
        }

        const px = b.pos?.[0] ?? 0;
        const pz = b.pos?.[2] ?? 0;
        const dx = tx - px;
        const dz = tz - pz;
        const dist = Math.hypot(dx, dz);
        b.goal = [tx, tz];
        b.goalDist = dist;

        if (dist < 1.2) {
          b.moving = false;
          if (!hunting) b.target = randomSpawn();
        } else {
          const speed = hunting ? 5.2 : 4.2;
          const step = Math.min(speed * dt, dist);
          const before = (b.pos as [number, number, number]) ?? [0, 0, 0];
          const base = Math.atan2(dx, dz);

          // There is no pathfinding here, so steer instead: try the direct line
          // first, then widening deviations, and keep whichever actually moves.
          const offsets = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6];
          if (b.avoidAngle) offsets.unshift(b.avoidAngle);

          let advanced = false;
          for (const off of offsets) {
            const heading = base + off;
            const cand = resolveMove(
              before,
              Math.sin(heading) * step,
              Math.cos(heading) * step,
              0.45
            );
            if (Math.hypot(cand[0] - before[0], cand[2] - before[2]) > step * 0.5) {
              b.pos = cand;
              b.rotY = heading;
              b.avoidAngle = off;
              advanced = true;
              break;
            }
          }

          if (advanced) {
            b.moving = true;
            b.stuck = 0;
          } else {
            b.moving = false;
            b.avoidAngle = 0;
            b.stuck = (b.stuck ?? 0) + dt;
            if ((b.stuck ?? 0) > 1) {
              const escape = randomSpawn();
              b.detour = [escape[0], escape[2]];
              b.detourUntil = now + 2500;
              b.target = escape;
              b.stuck = 0;
            }
          }
        }

        // Seeker bot catches whoever it reaches.
        if (hunting) {
          for (const o of bots.current) {
            if (o.role !== "hider" || o.caught || !o.pos) continue;
            if (Math.hypot(o.pos[0] - px, o.pos[2] - pz) < TAG.maxDistance) {
              o.caught = true;
              o.caughtAt = now;
            }
          }
          if (
            !caught.current &&
            seeker !== ME &&
            Math.hypot(myPos.current[0] - px, myPos.current[2] - pz) < TAG.maxDistance
          ) {
            caught.current = true;
            caughtAt.current = now;
          }
        }
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
          bots: bots.current.map((b) => ({
            account: b.account,
            role: b.role,
            caught: b.caught,
            pos: b.pos?.map((n) => +n.toFixed(1)),
            moving: b.moving,
            goalDist: b.goalDist != null ? +b.goalDist.toFixed(1) : null,
            stuck: b.stuck != null ? +b.stuck.toFixed(1) : null,
          })),
        };
      }

      forceTick((n) => n + 1);
    }, 200);

    return () => clearInterval(id);
  }, [joined, scene, phase, phaseEndsAt, ready, seeker, startRound, endRound]);

  /** Idle stand-ins so the hub isn't empty while testing locally. */
  const hubBots: PlayerState[] = useMemo(
    () =>
      BOTS.map((b, i) => ({
        account: b.account,
        nick: b.nick,
        pos: [-4 + i * 8, 0, 4],
        rotY: Math.PI,
        pose: 0,
        moving: false,
      })),
    []
  );

  const players: PlayerState[] = useMemo(() => {
    if (scene === "hub") {
      return [
        { account: ME, nick, pos: myPos.current, rotY: myRot.current, pose: 0, moving: false },
        ...hubBots,
      ];
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
    return [mine, ...bots.current.map(({ target, ...rest }) => (void target, rest))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nick, ready, seeker, phase, round, tick, scene, hubBots]);

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
    requestTag: async (target: string) => {
      if (phase !== "seeking" || seeker !== ME) return { ok: false };
      const bot = bots.current.find((b) => b.account === target);
      if (!bot || bot.caught) return { ok: false };
      bot.caught = true;
      bot.caughtAt = Date.now();
      return { ok: true };
    },
  };
}
