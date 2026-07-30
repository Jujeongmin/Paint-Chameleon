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
  // The gun has unlimited range and kills in one shot, so this curve is the
  // only thing a hider has to go on. Too flat and every shot sounds adjacent;
  // too steep and it may as well be silent.
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

if (failures === 0) {
  console.log("\n✅ audio logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
