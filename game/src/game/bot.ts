/**
 * Hider bots for the offline rehearsal rig.
 *
 * WHY THEY ARE HIDERS AND ONLY HIDERS. The seventh session deleted the offline
 * bots outright, and the reason is a rule rather than a bug: an AI may not be
 * the seeker. With bots in the room, a bot could be drawn as seeker, and the
 * offline rig was the one place in the project where that could actually
 * happen — online rooms only ever hold real people. Deleting them enforced the
 * rule by making it unrepresentable, at the cost of having nobody to hunt.
 *
 * These bots pay that cost back without reopening the hole: `startRound` still
 * assigns the seeker to the human unconditionally, and nothing here can be
 * assigned a role at all. check:bot asserts it against the catalogue rather
 * than trusting this comment.
 *
 * WHY THEY LIVE IN THE CLIENT. The server has no map — the seventh session
 * deleted its copy, and all it keeps now is a list of spawn points. Navigation
 * needs geometry, so a server-side bot could not walk anywhere. Client-side
 * bots would desync between peers in a real room, which is exactly why these
 * are confined to the offline rig: one client, no peers, nothing to disagree
 * with.
 *
 * WHY THE BRAIN IS PURE. Same reason as the rest of this project: a bot that
 * can only be judged by watching it is a bot nobody can judge. Everything here
 * is a function of state in and state out, so check:bot can run a whole round
 * of them at 60Hz against the real arena and the real movement integrator with
 * no renderer. The two things it cannot do — painting a canvas and existing in
 * React state — stay in offline.ts.
 */

import { CLUSTERS, FAMILIES, FLOOR_COLOR, SPAWN_POINTS, slotOf, type Family } from "./arena";
import { MAP_BOXES, type MapBox } from "./map";
import { MOVE } from "./constants";
import { createMotionState, stepMotion, type MotionState } from "./movement";
import { findRoute, simplifyRoute } from "./nav";

/**
 * Four. Enough that the arena has people in it and the seeker has to choose who
 * to chase, few enough that a rehearsal round stays short. The live room caps
 * at eight, so this leaves the count plausible against a real match.
 */
export const BOT_COUNT = 4;

/**
 * Bot names, as i18n keys. Seven of them, so four bots never repeat.
 *
 * Keys rather than words because a bot's nick shows up in the results table
 * next to the human ones, and a Korean name in an English results table would
 * be the one word on the screen nobody asked for.
 */
export const BOT_NAME_KEYS = ["bot.0", "bot.1", "bot.2", "bot.3", "bot.4", "bot.5", "bot.6"] as const;

/*
 * THEY DO NOT RUN. There used to be a flee radius here — a settled bot gave up
 * its spot when the seeker came within thirteen metres — and it is gone on
 * purpose.
 *
 * The game asks a hider to paint themselves the colour of the room and hold
 * still. Movement is the thing that gives you away; that is the entire premise.
 * A bot that bolts the moment somebody walks past is not playing the game the
 * player is playing, and it is also playing it badly — it converts a hider who
 * might not have been noticed into a moving target that certainly is.
 *
 * The cost, stated plainly: a bot cannot save itself. Once the seeker looks
 * straight at it, it is caught. That is the same deal a human hider takes when
 * they choose a spot and commit to it.
 */

/** Waypoint is reached at this distance; larger than the grid so it never stalls. */
const ARRIVE = 0.8;

export type BotGoal =
  /** Walking to a chosen hiding slot. */
  | "travel"
  /** Arrived: taking a pose and putting paint on. */
  | "settle"
  /** In place and still, whatever walks past. */
  | "hidden";

export interface BotState {
  account: string;
  /** i18n key for the display name; the rig localises it when publishing. */
  nameKey: string;
  body: string;
  motion: MotionState;
  rotY: number;
  pose: number;
  goal: BotGoal;
  /** Remaining waypoints, in order. Empty means "arrived, or never had one". */
  route: [number, number][];
  /** Which cluster slot it is heading for, as an index into CLUSTERS. */
  slot: number;
  /**
   * The colour it decided to wear, or null while it has not chosen. offline.ts
   * watches this and paints the canvas when it changes — the brain itself never
   * touches a canvas, which is what keeps it testable.
   */
  paint: number | null;
  caught: boolean;
  caughtAt: number | null;
  /** Deterministic RNG cursor. Same seed, same round, every time. */
  seed: number;
}

export interface BotWorld {
  boxes: MapBox[];
  /** Where the seeker is, or null while they are still in the cell. */
  seeker: [number, number, number] | null;
  phase: "lobby" | "hiding" | "seeking" | "results";
  now: number;
}

/** mulberry32, as everywhere else in this project. Advances the cursor in place. */
function nextRandom(bot: BotState): number {
  bot.seed = (bot.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(bot.seed ^ (bot.seed >>> 15), 1 | bot.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The colour a bot wears: whatever family of props it is standing among.
 *
 * This is the bot doing what the game asks a player to do — look at what is
 * around you and become that colour — with the eyedropper step replaced by
 * reading the palette directly. It cannot use the real eyedropper because that
 * one reads pixels out of a rendered material, and the whole point of this file
 * is that it runs without a renderer.
 *
 * Falls back to the floor's tone out in the open, which is also what a player
 * with nothing to hide behind would reach for.
 */
export function paintColorAt(x: number, z: number, boxes: MapBox[] = MAP_BOXES): number {
  let best = FLOOR_COLOR;
  // 3.5u is "among", not "in the same postcode as". A designed slot has its
  // row within about 1.3u, so a settled bot always finds one; standing in the
  // open crossroads finds nothing and wears the floor, which is the honest
  // answer for somebody with nothing to blend into.
  let bestDistance = 3.5;
  for (const b of boxes) {
    if (!b.family) continue;
    const family: Family | undefined = FAMILIES.find((f) => f.id === b.family);
    if (!family) continue;
    const d = Math.hypot(x - b.p[0], z - b.p[2]);
    if (d < bestDistance) {
      bestDistance = d;
      best = family.colors[0];
    }
  }
  return best;
}

/** Every cluster slot, as somewhere to stand. */
function slotAt(index: number): [number, number] {
  return slotOf(CLUSTERS[index % CLUSTERS.length]);
}

function planRoute(bot: BotState, slot: number, boxes: MapBox[]): void {
  const from: [number, number] = [bot.motion.pos[0], bot.motion.pos[2]];
  const to = slotAt(slot);
  const route = findRoute(from, to, {
    boxes,
    radius: MOVE.playerRadius,
    halfSize: 44,
  });
  bot.slot = slot;
  // No route means the slot is walled off from where the bot is standing. It
  // keeps the goal rather than freezing: the next choice will pick a different
  // slot, and standing still for one decision is better than teleporting.
  bot.route = route ? simplifyRoute(route).slice(1) : [];
}

/** Pick a slot this bot is not already at, biased to whatever is far from the seeker. */
function chooseSlot(bot: BotState, world: BotWorld): number {
  let best = bot.slot;
  let bestScore = -Infinity;
  for (let i = 0; i < CLUSTERS.length; i++) {
    if (i === bot.slot) continue;
    const [x, z] = slotAt(i);
    const fromSeeker = world.seeker
      ? Math.hypot(x - world.seeker[0], z - world.seeker[2])
      : 40;
    const fromMe = Math.hypot(x - bot.motion.pos[0], z - bot.motion.pos[2]);
    // Far from the seeker is the point; near to me is the tie-breaker, so a
    // fleeing bot does not sprint the length of the arena past the person
    // chasing it. The jitter keeps four bots from all choosing the same slot.
    const score = fromSeeker - fromMe * 0.45 + nextRandom(bot) * 6;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function createBots(count = BOT_COUNT, boxes: MapBox[] = MAP_BOXES): BotState[] {
  const bots: BotState[] = [];
  for (let i = 0; i < count; i++) {
    // Spawn points are shared with real hiders, and the human is the seeker
    // offline, so there is never a clash. Starting one slot in from the end of
    // the list keeps bots away from [0,0] where the seeker lands.
    const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
    const bot: BotState = {
      account: `bot-${i}`,
      nameKey: BOT_NAME_KEYS[i % BOT_NAME_KEYS.length],
      body: "classic",
      motion: createMotionState([spawn[0], 0, spawn[1]]),
      rotY: 0,
      pose: 0,
      goal: "travel",
      route: [],
      slot: -1,
      paint: null,
      caught: false,
      caughtAt: null,
      seed: 0x5eed + i * 7919,
    };
    planRoute(bot, chooseSlot(bot, { boxes, seeker: null, phase: "hiding", now: 0 }), boxes);
    bots.push(bot);
  }
  return bots;
}

/** Put every bot back at a spawn with a fresh plan. Called at round start. */
export function resetBots(bots: BotState[], boxes: MapBox[] = MAP_BOXES): void {
  bots.forEach((bot, i) => {
    const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
    bot.motion = createMotionState([spawn[0], 0, spawn[1]]);
    bot.goal = "travel";
    bot.pose = 0;
    bot.paint = null;
    bot.caught = false;
    bot.caughtAt = null;
    bot.slot = -1;
    planRoute(bot, chooseSlot(bot, { boxes, seeker: null, phase: "hiding", now: 0 }), boxes);
  });
}

/**
 * One bot, one frame. Mutates in place — these are simulation state, not React
 * state, and copying four of them sixty times a second buys nothing.
 */
export function stepBot(bot: BotState, world: BotWorld, dt: number): void {
  if (bot.caught) {
    // Caught bots stop dead rather than vanish. A body left where it was found
    // is how the seeker can see their own progress across the arena.
    stepMotion(bot.motion, { forward: 0, strafe: 0, jump: false }, bot.rotY, {
      boxes: world.boxes,
      dt,
      now: world.now,
      speed: 0,
      radius: MOVE.playerRadius,
    });
    return;
  }

  const [x, , z] = bot.motion.pos;

  // Nothing to decide. Where the seeker is does not enter into it — see the
  // note at the top of this file about why they hold still.

  // --- walk.
  let forward = 0;
  if (bot.route.length > 0) {
    const [wx, wz] = bot.route[0];
    const dx = wx - x;
    const dz = wz - z;
    if (Math.hypot(dx, dz) < ARRIVE) {
      bot.route.shift();
    } else {
      // Turn toward the waypoint rather than snapping: the body's facing is
      // what everyone else sees, and an instant spin reads as a glitch.
      const want = Math.atan2(dx, dz);
      let diff = ((want - bot.rotY + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (diff < -Math.PI) diff += Math.PI * 2;
      bot.rotY += diff * Math.min(1, dt * 8);
      forward = 1;
    }
  } else if (bot.goal === "travel") {
    // Route exhausted: arrived, or never had one.
    bot.goal = "settle";
  }

  // A walk, not a run, and slower than a human's top speed. The only walking a
  // bot does now is getting to its spot before the hunt starts, and it has the
  // whole hiding phase to do it in — the measured worst case is under four
  // seconds (check:balance).
  const speed = MOVE.hiderSpeed * 0.85;

  stepMotion(bot.motion, { forward, strafe: 0, jump: false }, bot.rotY, {
    boxes: world.boxes,
    dt,
    now: world.now,
    speed,
    radius: MOVE.playerRadius,
  });

  // --- settle: pick a pose, pick a colour, go still.
  if (bot.goal === "settle") {
    // Any pose but standing. Standing is what everything in the arena that
    // ISN'T hiding does, so a hider who picks it has not hidden.
    bot.pose = 1 + Math.floor(nextRandom(bot) * 3);
    bot.paint = paintColorAt(bot.motion.pos[0], bot.motion.pos[2], world.boxes);
    bot.goal = "hidden";
  }
}

/**
 * Whether a bot has left the arena for good — which is any bot that has been
 * caught, in EITHER mode.
 *
 * A human caught in tag converts and keeps playing, and this is the one place
 * that difference is refused. The reason is the rule the whole file is built
 * around: an AI may never be the seeker, so a bot has nowhere to convert TO.
 *
 * It is a function rather than an inline `bot.caught` at the call site because
 * the mode-shaped version is what someone would naturally write, and the check
 * that stops them needs something to point at.
 */
export function botIsOut(bot: BotState): boolean {
  return bot.caught;
}

export function stepBots(bots: BotState[], world: BotWorld, dt: number): void {
  for (const bot of bots) stepBot(bot, world, dt);
}
