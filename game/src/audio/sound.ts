/**
 * Sound.
 *
 * This file used to say every effect was synthesised "to avoid the licensing
 * questions external audio assets would raise". That reasoning had already
 * expired: the arena has been built out of Kenney's CC0 model kits since the
 * seventh session, and Kenney's audio is CC0 on the same terms — public
 * domain, no attribution required. The question the comment was avoiding was
 * answered by the models, not by the audio.
 *
 * So the cues are files now (public/audio/, see the README there for exactly
 * which pack each came from). Two things are still synthesised, and both for
 * reasons rather than inertia:
 *
 *  - The blaster's low thump, layered under the sampled zap. The packs have no
 *    firearm at all — they are footsteps, impacts and interface clicks — and a
 *    metal clang is not a gunshot. What is sampled is the electronic crack (28ms
 *    of it); the body under it is still an oscillator.
 *  - A low tail under the hunt-start bell, which is 132ms on its own. Both
 *    durations were measured in a browser rather than assumed.
 *
 * The pure helpers below (`shouldPlayBrushTick`, `shotGainFor`) stay pure and
 * stay exported, because check:audio pins the throttle and the distance curve
 * and neither of those has anything to do with where the sound came from.
 */

let ctx: AudioContext | null = null;
let lastBrushTickAt = 0;

// ------------------------------------------------------------ sampled cues

/**
 * The files, and what each is for. Kenney CC0 — see public/audio/README.md.
 *
 * Decoded once into an AudioBuffer and replayed from there: a BufferSource is
 * single-use but the buffer behind it is not, so a catch that fires four times
 * in a round decodes once.
 */
const CLIPS = {
  shot: "/audio/shot.ogg",
  catch: "/audio/catch.ogg",
  roundStart: "/audio/round-start.ogg",
  huntStart: "/audio/hunt-start.ogg",
  win: "/audio/win.ogg",
  lose: "/audio/lose.ogg",
  brush: "/audio/brush.ogg",
} as const;

type ClipName = keyof typeof CLIPS;

const buffers = new Map<ClipName, AudioBuffer>();
const SOUND_TIMEOUT_MS = 8_000;

/**
 * Fetch and decode every clip. Called from the loading screen's warmup.
 *
 * Failure is deliberately survivable and silent: a cue that could not be
 * fetched simply does not play. An exception here would take down the loading
 * screen, and a game with one missing sound is better than a game that will
 * not start.
 */
export async function loadSounds(): Promise<void> {
  if (!ctx) return;
  await Promise.all(
    (Object.keys(CLIPS) as ClipName[]).map(async (name) => {
      if (buffers.has(name)) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SOUND_TIMEOUT_MS);
      try {
        const response = await fetch(CLIPS[name], { signal: controller.signal });
        const bytes = await response.arrayBuffer();
        buffers.set(name, await ctx!.decodeAudioData(bytes));
      } catch {
        // See above.
      } finally {
        clearTimeout(timeout);
      }
    })
  );
}

/**
 * Play a decoded clip.
 *
 * `rate` detunes by resampling, which is how four catches in a row stop
 * sounding like the same recording four times. Silently does nothing if the
 * clip never loaded, if there is no context yet, or if the player is muted —
 * every caller is a game event that must not care about any of those.
 */
function play(name: ClipName, gainValue = 0.5, rate = 1): void {
  if (!ctx || isMuted()) return;
  const buffer = buffers.get(name);
  if (!buffer) return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = gainValue;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

/** A little either side of 1.0, so repeats of the same clip are not identical. */
function varyRate(spread = 0.08): number {
  return 1 + (Math.random() * 2 - 1) * spread;
}

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
  // The sampled crack, plus the synthesised thump underneath it — see the note
  // at the top of this file about why this one cue is still half-generated.
  play("shot", gain, varyRate(0.05));
  tone(90, 0.12, gain * 0.5, "square");
}

/** Short, bright two-note stinger — a hider or seeker was just caught. */
export function playCatch(): void {
  // Fires once per catch and, in tag, once per conversion — so up to seven
  // times in a round. The rate variation is what stops that reading as the
  // same recording on a loop.
  play("catch", 0.45, varyRate());
}

/** Soft filtered noise tick, throttled internally so a fast drag doesn't spam it. */
export function playBrushTick(): void {
  const now = performance.now();
  if (!shouldPlayBrushTick(now, lastBrushTickAt)) return;
  lastBrushTickAt = now;
  // The most repeated sound in the game by far — one every 100ms while a brush
  // is moving. Quiet, and detuned more widely than the rest.
  play("brush", 0.16, varyRate(0.14));
}

/** Rising two-note cue — the hiding phase just started. */
export function playRoundStart(): void {
  play("roundStart", 0.5);
}

/**
 * The hunt is on. Played on hiding -> seeking, for everybody.
 *
 * Deliberately not another rising figure like playRoundStart. That one says
 * "get moving"; this one has to say "time is up", and the seeker in particular
 * has spent the whole hiding phase underground with nothing to look at — the
 * cue is the moment they are let out, so it wants to land like a door opening
 * rather than like a countdown ticking on.
 *
 * Falling fifth into a low sustain, with the two notes overlapping so it reads
 * as one gesture instead of two beeps.
 */
export function playHuntStart(): void {
  // A struck bell, with a low tail under it.
  //
  // The bell alone is 132ms — measured in a browser, not guessed — and that is
  // a notification, not an announcement. The seeker has spent the whole hiding
  // phase underground and this is the door opening, so it wants to hang in the
  // air. The sample is the strike; the oscillator is the room it rings in.
  play("huntStart", 0.55);
  tone(146.83, 0.55, 0.16, "sawtooth", 0.02);
}

/** Bright major arpeggio on a win, a single low tone on a loss. */
export function playResults(won: boolean): void {
  play(won ? "win" : "lose", 0.5);
}
