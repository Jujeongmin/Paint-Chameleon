/**
 * Sound module's testable logic — the actual Web Audio synthesis can't run
 * headless (no AudioContext in Node), so this covers the throttle math and
 * mute-state persistence instead.
 *
 * Run: npm run check:audio
 */

// A minimal in-memory localStorage so isMuted()/toggleMuted() have something
// real to read and write — there's no browser storage under Node.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
(globalThis as any).localStorage = new MemoryStorage();

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import {
  isMuted,
  shouldPlayBrushTick,
  toggleMuted,
  playCatch,
  playBrushTick,
  playRoundStart,
  playResults,
  SHOT_AUDIO,
  shotGainFor,
  playShot,
} from "../game/src/audio/sound";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓ " + label);
  else {
    console.error(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
    failures++;
  }
}

console.log("\nmute state");
{
  check("starts unmuted by default", isMuted() === false);
  const afterFirstToggle = toggleMuted();
  check("toggling once mutes", afterFirstToggle === true && isMuted() === true);
  const afterSecondToggle = toggleMuted();
  check("toggling again unmutes", afterSecondToggle === false && isMuted() === false);
}

console.log("\nbrush tick throttle");
{
  check("first tick always plays (lastPlayedAt far in the past)", shouldPlayBrushTick(1000, 0));
  check("a tick 50ms after the last one is suppressed", !shouldPlayBrushTick(1050, 1000, 100));
  check("a tick exactly at the throttle boundary plays", shouldPlayBrushTick(1100, 1000, 100));
  check("a tick well after the throttle window plays", shouldPlayBrushTick(5000, 1000, 100));
}

console.log("\nplay* functions never throw without an AudioContext");
{
  let threw = false;
  try {
    playCatch();
    playBrushTick();
    playRoundStart();
    playResults(true);
    playResults(false);
  } catch {
    threw = true;
  }
  check("play* calls with no AudioContext complete without throwing", !threw);
}

console.log("\nshot loudness falls off with distance");
{
  // Only a shot that caught someone is ever broadcast (misses stop at the
  // client, refusals stop at the server), so this curve is a kill cue: it is
  // what tells a surviving hider how far away the seeker was when someone else
  // was caught. Too flat and every catch sounds adjacent; too steep and it may
  // as well be silent.
  check("your own shot is loudest", shotGainFor(0) === SHOT_AUDIO.maxGain);

  // Scans the whole audible range rather than re-checking distance 0 — a
  // single extra point can't catch a curve that overshoots partway out.
  let withinCeiling = true;
  for (let d = 0; d <= SHOT_AUDIO.audibleDistance; d += 0.5) {
    if (shotGainFor(d) > SHOT_AUDIO.maxGain) withinCeiling = false;
  }
  check("nothing across the curve exceeds the ceiling", withinCeiling);

  check(
    `beyond ${SHOT_AUDIO.audibleDistance}u it is silent`,
    shotGainFor(SHOT_AUDIO.audibleDistance) === 0 && shotGainFor(999) === 0
  );

  let monotonic = true;
  let previous = Infinity;
  for (let d = 0; d <= SHOT_AUDIO.audibleDistance + 10; d += 0.5) {
    const g = shotGainFor(d);
    if (g > previous + 1e-12 || g < 0) monotonic = false;
    previous = g;
  }
  check("it never rises with distance and never goes negative", monotonic);

  // A mid-range shot has to be audibly there — a curve that collapses to
  // nothing by 10u would make the whole broadcast pointless.
  const mid = shotGainFor(SHOT_AUDIO.audibleDistance / 3);
  check(
    `a shot a third of the way out is still audible (${mid.toFixed(3)})`,
    mid > SHOT_AUDIO.maxGain * 0.1
  );

  // shotGainFor is pure specifically so this curve can be pinned here — the
  // docstring says so. A linear falloff clears every other check above (it
  // still starts at maxGain, ends at 0, never rises, stays under the
  // mid-audibility floor), so without this, swapping in a straight ramp would
  // leave check:audio green while quietly changing the only cue a hider has.
  // Halfway out, quadratic gives maxGain/4; linear gives maxGain/2 — the
  // threshold splits the two.
  const halfway = shotGainFor(SHOT_AUDIO.audibleDistance / 2);
  check(
    `curve decays faster than linear at the midpoint (${halfway.toFixed(3)})`,
    halfway < SHOT_AUDIO.maxGain / 3
  );

  // Rubbish in must not become a burst of noise at full volume.
  check("NaN is silent", shotGainFor(NaN) === 0);
  check("a negative distance is silent", shotGainFor(-5) === 0);
}

console.log("\nthe shot can be played without an AudioContext");
{
  // Same contract as every other cue here: muted or headless, it no-ops rather
  // than throwing. A sound that crashes the render loop is worse than silence.
  let threw = false;
  try {
    playShot(shotGainFor(12));
    playShot(0);
  } catch {
    threw = true;
  }
  check("playShot does not throw without a real AudioContext", !threw);
}

console.log("\nevery cue has a file, and every file is used");
{
  // The cues are samples now, and a missing file is silent rather than loud —
  // loadSounds swallows a failed fetch on purpose, because a game that will not
  // start is worse than a game with one missing sound. That trade is only safe
  // if something else notices the file is gone, and this is that something.
  const dir = "public/audio";
  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".ogg")).sort();

  // Read the names straight out of the module rather than repeating them: a
  // list here would be a second place to forget.
  const source = readFileSync("game/src/audio/sound.ts", "utf8");
  const referenced = [...source.matchAll(/"\/audio\/([\w-]+\.ogg)"/g)].map((m) => m[1]).sort();

  check(`${referenced.length} cues are wired`, referenced.length > 0);

  const missing = referenced.filter((f) => !onDisk.includes(f));
  check("every cue the code plays exists on disk", missing.length === 0, missing.join(", "));

  const unused = onDisk.filter((f) => !referenced.includes(f));
  check(
    "and nothing ships that nothing plays",
    unused.length === 0,
    `public/ is copied wholesale into the build, so an unused clip is dead weight a player downloads: ${unused.join(", ")}`
  );

  // Kenney's packs are hundreds of files; the point of copying seven was to
  // keep the download small. A number that creeps back up is worth noticing.
  const bytes = onDisk.reduce((sum, f) => sum + statSync(`${dir}/${f}`).size, 0);
  check(
    `the whole set is small (${Math.round(bytes / 1024)}KB)`,
    bytes < 400 * 1024,
    "the three source packs are 2MB; only what is played should be in public/"
  );

  check(
    "the licence is written down next to the files",
    existsSync(`${dir}/README.md`),
    "CC0 needs no attribution, but where a file came from still has to be findable"
  );
}

if (failures === 0) {
  console.log("\n✅ audio logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
