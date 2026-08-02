/**
 * Hider bots: the claims that matter, run against the real arena.
 *
 * The bot brain is pure so this can exist. Everything below drives whole rounds
 * at 60Hz through the game's own movement integrator and the arena's own
 * collision boxes — no renderer, no React, no server. What it cannot judge is
 * how the bots LOOK doing it.
 *
 * Two of these assertions are about a rule rather than about quality, and they
 * are the reason this file exists at all: an AI may never be the seeker, and a
 * bot must never end up somewhere a player could not walk. The rest is whether
 * the thing works.
 *
 * Run: npm run check:bot
 */

import {
  BOT_COUNT,
  botIsOut,
  createBots,
  paintColorAt,
  resetBots,
  stepBots,
  type BotState,
  type BotWorld,
} from "../game/src/game/bot";
import { CLUSTERS, FAMILIES, FLOOR_COLOR, slotOf } from "../game/src/game/arena";
import { MAP_BOXES, playerBlockedAt } from "../game/src/game/map";
import { MOVE, PHASE_SECONDS } from "../game/src/game/constants";
import { t, type Key } from "../game/src/ui/i18n";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

const DT = 1 / 60;

/**
 * A bot's display name, for the labels below.
 *
 * Bots carry an i18n KEY rather than a name — their nick shows up in the
 * results table next to human ones and had to be translatable. These labels
 * read "undefined" for a while because this file was still reaching for
 * `bot.nick`, and nothing caught it: scripts/ was outside tsconfig's `include`,
 * so none of the check scripts had ever been typechecked.
 */
function name(bot: BotState): string {
  return t(bot.nameKey as Key);
}

function world(over: Partial<BotWorld> = {}): BotWorld {
  return { boxes: MAP_BOXES, seeker: null, phase: "hiding", now: 0, ...over };
}

/** Run `seconds` of simulation, calling `each` once per frame after the step. */
function run(
  bots: BotState[],
  seconds: number,
  make: (frame: number) => BotWorld,
  each?: (frame: number) => void
): void {
  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames; f++) {
    stepBots(bots, make(f), DT);
    each?.(f);
  }
}

console.log("\nthe rule: a bot is never the seeker");
{
  // Not a behaviour, a shape. BotState has no role field to set, so a bot
  // cannot be assigned one — this asserts the type stays that way, because the
  // day someone adds `role` is the day the rule becomes breakable again.
  const bots = createBots();
  const keys = Object.keys(bots[0]);
  check(`bot state carries no role at all (${keys.length} fields)`, !keys.includes("role"));
  check("every bot has its own account", new Set(bots.map((b) => b.account)).size === bots.length);
}

console.log("\nthey get somewhere to hide within the hiding phase");
{
  const bots = createBots();
  run(bots, PHASE_SECONDS.hiding, () => world());

  for (const bot of bots) {
    check(`${name(bot)} stopped travelling (${bot.goal})`, bot.goal === "hidden");
    // Not "reached the exact slot" — collision and the 0.8u arrival radius mean
    // a bot settles near it, and near enough to be among the props is the claim
    // the design actually makes.
    const [sx, sz] = slotOf(CLUSTERS[bot.slot]);
    const d = Math.hypot(bot.motion.pos[0] - sx, bot.motion.pos[2] - sz);
    check(`${name(bot)} settled by its slot (${d.toFixed(2)}u)`, d < 3.5);
  }
}

console.log("\nand they are somewhere a player could stand");
{
  // A bot inside the scenery would be unshootable cover-cheating, and it would
  // also mean the movement code let it in. Checked every frame of a whole
  // round rather than at the end, because passing THROUGH a wall and coming out
  // the far side would go unnoticed by a final-position test.
  const bots = createBots();
  let worst = "";
  let bad = 0;
  run(bots, PHASE_SECONDS.hiding, () => world(), () => {
    for (const bot of bots) {
      if (playerBlockedAt(bot.motion.pos[0], bot.motion.pos[2], 0, MOVE.playerRadius, MAP_BOXES)) {
        bad++;
        if (!worst) {
          worst = `${name(bot)} at (${bot.motion.pos[0].toFixed(1)}, ${bot.motion.pos[2].toFixed(1)})`;
        }
      }
    }
  });
  check(`no bot is ever inside geometry (${bad} frame-bots)`, bad === 0, worst);

  for (const bot of bots) {
    check(`${name(bot)} is on the floor, not in the air (y ${bot.motion.pos[1].toFixed(2)})`, bot.motion.pos[1] < 0.01);
  }
}

console.log("\nthey wear a colour off the map, and it is not the default white");
{
  const bots = createBots();
  run(bots, PHASE_SECONDS.hiding, () => world());

  const palette = new Set<number>([FLOOR_COLOR, ...FAMILIES.flatMap((f) => f.colors)]);
  for (const bot of bots) {
    check(`${name(bot)} chose a colour`, bot.paint !== null, `${bot.paint}`);
    check(
      `${name(bot)}'s colour comes from the arena's own palette`,
      bot.paint !== null && palette.has(bot.paint),
      `0x${(bot.paint ?? 0).toString(16)}`
    );
  }

  // The colour has to depend on WHERE you are, or "paints itself to match its
  // surroundings" is just "paints itself".
  const drum = paintColorAt(-34, -32);
  const pillar = paintColorAt(18, 20);
  check("standing among drums and among pillars give different colours", drum !== pillar, `${drum} vs ${pillar}`);

  // The fallback is tested against an empty arena rather than against an empty
  // PATCH of this one. Two earlier attempts got this wrong in the same way: the
  // centre is not open (crates sit 3.2u out, since the clutter sampler only
  // keeps 3u clear around the seeker's landing spot), and on a wider search
  // NOWHERE in the arena is 5u clear of a prop. Handing the function no boxes
  // asks about the function; picking a coordinate asks about the layout.
  check("with nothing around, a bot wears the floor", paintColorAt(0, 0, []) === FLOOR_COLOR);

  // How far you have to go to find nothing to hide near. Reported rather than
  // asserted — it is a fact about how dense the arena got, and the number
  // moving is interesting rather than wrong.
  let loneliest = 0;
  for (let x = -40; x <= 40; x += 2) {
    for (let z = -40; z <= 40; z += 2) {
      let nearest = Infinity;
      for (const b of MAP_BOXES) {
        if (!b.family) continue;
        nearest = Math.min(nearest, Math.hypot(x - b.p[0], z - b.p[2]));
      }
      loneliest = Math.max(loneliest, nearest);
    }
  }
  console.log(`  ·     emptiest spot in the arena is ${loneliest.toFixed(1)}u from the nearest prop`);
}

console.log("\nthey do NOT run when the seeker closes in");
{
  // The inverse of what this file used to assert. The game asks a hider to
  // hold still; movement is what gives you away. A bot that bolts when
  // somebody walks past turns a hider who might not have been noticed into a
  // moving target that certainly is — and it is not playing the game the
  // player is playing.
  const bots = createBots();
  run(bots, PHASE_SECONDS.hiding, () => world());

  // Park the seeker directly on top of one of them for six seconds.
  const target = bots[0];
  const spot: [number, number, number] = [target.motion.pos[0], 0, target.motion.pos[2]];
  const before = { x: spot[0], z: spot[2], pose: target.pose, paint: target.paint };

  run(bots, 6, (f) => world({ phase: "seeking", seeker: spot, now: f * DT * 1000 }));

  const moved = Math.hypot(target.motion.pos[0] - before.x, target.motion.pos[2] - before.z);
  check(`a bot with the seeker on top of it does not move (${moved.toFixed(3)}u)`, moved < 0.05);
  check("...and does not break its pose", target.pose === before.pose);
  check("...and does not repaint", target.paint === before.paint);
  check("...and is still hidden, not travelling", target.goal === "hidden");
  check("nor does anybody else start moving", bots.every((b) => b.goal === "hidden"));
}


console.log("\nthey outlive a whole round without breaking");
{
  // A full round at 60Hz with the seeker patrolling: the failure this catches is
  // a bot that wedges, oscillates between two goals forever, or walks off the
  // map. Nothing about it should end with a bot still travelling.
  const bots = createBots();
  const total = PHASE_SECONDS.hiding + PHASE_SECONDS.seeking;
  run(bots, total, (f) => {
    const t = f * DT;
    if (t < PHASE_SECONDS.hiding) return world({ now: t * 1000 });
    // A seeker sweeping a big circle through the arena.
    const a = ((t - PHASE_SECONDS.hiding) / PHASE_SECONDS.seeking) * Math.PI * 2;
    return world({
      phase: "seeking",
      seeker: [Math.cos(a) * 26, 0, Math.sin(a) * 26],
      now: t * 1000,
    });
  });

  for (const bot of bots) {
    check(`${name(bot)} ended the round settled or running, not stuck (${bot.goal})`, bot.goal !== "travel");
    const inside = Math.abs(bot.motion.pos[0]) < 44 && Math.abs(bot.motion.pos[2]) < 44;
    check(`${name(bot)} is still inside the arena`, inside, `(${bot.motion.pos[0].toFixed(1)}, ${bot.motion.pos[2].toFixed(1)})`);
  }
}

console.log("\na round can be replayed exactly");
{
  // The rig has to be able to reproduce a round, or "the bot did something odd"
  // is never investigable. Same seeds, same arena, same result.
  const a = createBots();
  const b = createBots();
  const patrol = (f: number) =>
    world({ phase: "seeking", seeker: [Math.cos(f / 400) * 20, 0, Math.sin(f / 400) * 20], now: f * DT * 1000 });
  run(a, 20, patrol);
  run(b, 20, patrol);
  const same = a.every(
    (bot, i) =>
      Math.abs(bot.motion.pos[0] - b[i].motion.pos[0]) < 1e-9 &&
      Math.abs(bot.motion.pos[2] - b[i].motion.pos[2]) < 1e-9 &&
      bot.pose === b[i].pose &&
      bot.paint === b[i].paint
  );
  check("two runs of the same seeds land identically", same);

  // ...and resetting gives a fresh round rather than a half-finished one.
  resetBots(a);
  check(`reset clears the paint and the pose`, a.every((bot) => bot.paint === null && bot.pose === 0));
  check(`reset puts everyone back on the floor`, a.every((bot) => bot.motion.pos[1] === 0));
  check(`reset un-catches everyone`, a.every((bot) => !bot.caught));
}

console.log("\na caught bot is out, in both rooms");
{
  // The rule this pins is the one that does NOT follow the game mode. A human
  // caught in tag converts to a seeker and keeps playing; a bot cannot, because
  // an AI may never be the seeker. So a caught bot is removed in either room —
  // and leaving its body lying in the arena said the opposite, since in tag a
  // body on the floor is somebody about to get up and hunt you.
  const bots = createBots();
  check("a fresh bot is in play", bots.every((b) => !botIsOut(b)));
  bots[0].caught = true;
  check("a caught bot is out", botIsOut(bots[0]));
  check(
    "and the answer does not depend on the mode",
    bots.every((b) => botIsOut(b) === b.caught),
    "tag converts a human and removes a bot — that asymmetry is the point"
  );
  resetBots(bots);
  check("a new round puts it back in play", bots.every((b) => !botIsOut(b)));
}


console.log("\ncaught bots stop");
{
  const bots = createBots();
  run(bots, PHASE_SECONDS.hiding, () => world());
  const victim = bots[0];
  victim.caught = true;
  const at: [number, number] = [victim.motion.pos[0], victim.motion.pos[2]];
  // Park the seeker on top of them: alive, this is exactly what makes a bot run.
  run(bots, 5, (f) =>
    world({ phase: "seeking", seeker: [at[0], 0, at[1]], now: f * DT * 1000 })
  );
  const moved = Math.hypot(victim.motion.pos[0] - at[0], victim.motion.pos[2] - at[1]);
  check(`a caught bot stays where it was found (${moved.toFixed(2)}u)`, moved < 0.5);
}

console.log(`\n${BOT_COUNT} bots, ${CLUSTERS.length} slots to choose between`);

if (failures === 0) {
  console.log("\n✅ the bots behave\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
