/**
 * All effects here are synthesized at play time with the Web Audio API, not
 * loaded from files — this project keeps every asset procedurally generated
 * to avoid the licensing questions external audio/3D assets would raise (see
 * the copyright note at the top of README.md).
 */

let ctx: AudioContext | null = null;
let lastBrushTickAt = 0;

const MUTE_KEY = "pc-muted";
const BRUSH_TICK_THROTTLE_MS = 100;

/** Call from inside a user gesture (a click handler) — autoplay policy requires it. */
export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return;
  }
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Flips the stored mute flag and returns the new state (true = now muted). */
export function toggleMuted(): boolean {
  const next = !isMuted();
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, etc.) — the in-memory toggle still
    // works for this page load, it just won't persist.
  }
  return next;
}

/** Pure so the throttle timing can be tested without a real clock or AudioContext. */
export function shouldPlayBrushTick(now: number, lastPlayedAt: number, throttleMs = BRUSH_TICK_THROTTLE_MS): boolean {
  return now - lastPlayedAt >= throttleMs;
}

function tone(freq: number, duration: number, startGain: number, type: OscillatorType = "sine", delay = 0): void {
  if (!ctx || isMuted()) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(startGain, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

function noiseBurst(duration: number, gainValue: number, filterFreq: number): void {
  if (!ctx || isMuted()) return;
  const t0 = ctx.currentTime;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, t0);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(t0);
  source.stop(t0 + duration);
}

/**
 * How far a gunshot carries, and how loud it is at the muzzle.
 *
 * This is a KILL cue, not a fire cue. App.tsx drops a miss before the RPC and
 * server.ts returns before broadcasting on any refusal, so the only "shot"
 * anyone else ever hears is one that caught somebody — at most once per hider
 * per round. What the curve conveys is therefore how far away the seeker was
 * when someone else died, not that the seeker is shooting.
 *
 * 60u is a little under half the arena's 124u diagonal: far enough that a
 * catch nearby reads as nearby, close enough that a catch on the opposite side
 * of the arena is silent rather than telling the whole map at once.
 */
export const SHOT_AUDIO = { audibleDistance: 60, maxGain: 0.3 };

/**
 * Gain for a shot heard `distance` away. Pure so check:audio can pin the curve
 * — there is no AudioContext under Node.
 *
 * Quadratic rather than linear: linear falloff sounds wrong, because loudness
 * is perceived roughly logarithmically and a straight ramp reads as a shot that
 * stays loud and then stops abruptly.
 */
export function shotGainFor(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance >= SHOT_AUDIO.audibleDistance) return 0;
  const t = distance / SHOT_AUDIO.audibleDistance;
  return SHOT_AUDIO.maxGain * (1 - t) * (1 - t);
}

/**
 * A gunshot: a filtered noise crack with a short low thump under it.
 *
 * `gain` comes from shotGainFor, so the same broadcast is loud for the shooter
 * and faint for a hider two zones away.
 */
export function playShot(gain: number): void {
  if (gain <= 0) return;
  noiseBurst(0.08, gain, 2600);
  tone(90, 0.12, gain * 0.6, "square");
}

/** Short, bright two-note stinger — a hider or seeker was just caught. */
export function playCatch(): void {
  tone(440, 0.2, 0.3, "square");
  tone(330, 0.18, 0.2, "square", 0.05);
}

/** Soft filtered noise tick, throttled internally so a fast drag doesn't spam it. */
export function playBrushTick(): void {
  const now = performance.now();
  if (!shouldPlayBrushTick(now, lastBrushTickAt)) return;
  lastBrushTickAt = now;
  noiseBurst(0.03, 0.08, 1200);
}

/** Rising two-note cue — the hiding phase just started. */
export function playRoundStart(): void {
  tone(392, 0.15, 0.25, "sine");
  tone(523.25, 0.25, 0.25, "sine", 0.12);
}

/** Bright major arpeggio on a win, a single low tone on a loss. */
export function playResults(won: boolean): void {
  if (won) {
    tone(523.25, 0.18, 0.25, "triangle");
    tone(659.25, 0.18, 0.25, "triangle", 0.1);
    tone(783.99, 0.3, 0.25, "triangle", 0.2);
  } else {
    tone(220, 0.5, 0.25, "sawtooth");
  }
}
