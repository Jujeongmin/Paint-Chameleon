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

import { isMuted, shouldPlayBrushTick, toggleMuted } from "../src/audio/sound";

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

if (failures === 0) {
  console.log("\n✅ audio logic is consistent\n");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} problem(s)\n`);
  process.exit(1);
}
