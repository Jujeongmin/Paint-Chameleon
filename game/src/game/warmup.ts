import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARENA_TEXTURE_URLS } from "./ArenaScene";
import { GUN_URL } from "./Gun";
import { MODEL_URLS } from "./props";
import { MAP_BOXES } from "./map";
import { CELL_BOXES } from "./cell";
import { HUB_BOXES } from "../hub/hubMap";
import { MOVE, SEEKER_SCALE } from "./constants";
import { prewarmNav } from "./nav";
import { loadSounds } from "../audio/sound";
import { t } from "../ui/i18n";

/**
 * Everything expensive, done before the round instead of during it.
 *
 * The arena costs real time to get ready and every piece of that cost used to
 * be paid at the worst possible moment. Two kinds of cost, and they need
 * different handling:
 *
 * DOWNLOADS AND PARSING. Thirteen GLB models and six textures. React suspends
 * while they arrive, which is why the arena used to pop in — and the seeker's
 * blaster loads on the hiding -> seeking transition, so the gun could arrive
 * late into a round already in progress.
 *
 * COMPUTATION. The bots' walkability grid is ~31,000 collision tests. Left to
 * happen lazily it landed on the first frame a bot needed a route, which is the
 * first frame the seeker got close to one — a stall exactly when the game is at
 * its busiest. See nav.ts for the measurements.
 *
 * Doing both here is the whole argument for having a loading screen at all: a
 * wait you are told about, before you are playing, is not lag.
 */

/** One unit of work, with a name the loading screen can show. */
interface Step {
  label: string;
  run: () => Promise<void> | void;
}

/**
 * Fetch a URL into the browser's HTTP cache and report bytes as they arrive.
 *
 * The actual parse happens later, in the loaders R3F itself uses — priming the
 * cache here rather than parsing twice. A failed fetch is not fatal: the loader
 * will simply fetch it again for real, and a loading screen that refuses to
 * finish because one texture 404'd is worse than a missing texture.
 */
async function prefetch(url: string): Promise<void> {
  try {
    const response = await fetch(url);
    await response.arrayBuffer();
  } catch {
    // Deliberately swallowed — see above.
  }
}

function steps(): Step[] {
  const out: Step[] = [];

  for (const url of MODEL_URLS) {
    out.push({ label: t("load.models"), run: () => prefetch(url) });
  }
  for (const url of ARENA_TEXTURE_URLS) {
    out.push({ label: t("load.textures"), run: () => prefetch(url) });
  }
  out.push({ label: t("load.weapon"), run: () => prefetch(GUN_URL) });

  // Now hand the same URLs to the loaders React will use, so that by the time a
  // component asks for them there is nothing left to suspend on. The arrays
  // matter: useLoader caches on exactly the argument it was given, so priming
  // with the same array `useProps` passes is what makes the entry a hit.
  out.push({
    label: t("load.parsing"),
    run: () => {
      useLoader.preload(GLTFLoader, MODEL_URLS);
      useLoader.preload(THREE.TextureLoader, ARENA_TEXTURE_URLS as unknown as string[]);
      useLoader.preload(GLTFLoader, GUN_URL);
    },
  });

  out.push({
    label: t("load.audio"),
    // Fetched and decoded here for the same reason as everything else on this
    // screen: the first catch of the round is a bad moment to discover a clip
    // has not arrived. It resolves even if a file is missing — see loadSounds.
    run: () => loadSounds(),
  });

  out.push({
    label: t("load.terrain"),
    run: () => {
      // Both radii: a hider's and the giant seeker's. check:map floods at the
      // seeker's, the bots at a hider's, and neither should be the one that
      // pays for building it.
      prewarmNav({ boxes: MAP_BOXES, radius: MOVE.playerRadius, halfSize: 44 });
      prewarmNav({ boxes: MAP_BOXES, radius: MOVE.playerRadius * SEEKER_SCALE, halfSize: 44 });
      prewarmNav({ boxes: HUB_BOXES, radius: MOVE.playerRadius, halfSize: 24 });
      prewarmNav({ boxes: CELL_BOXES, radius: MOVE.playerRadius, halfSize: 12, feetY: -8 });
    },
  });

  return out;
}

export interface WarmupProgress {
  done: number;
  total: number;
  label: string;
}

/**
 * Run every step, reporting progress between each.
 *
 * Yields to the browser between steps rather than running them back to back:
 * the loading screen is a React tree like any other and cannot repaint while
 * this holds the thread. Without the yield the bar would jump from empty to
 * full in one frame, which is a progress bar that has told you nothing.
 */
export async function runWarmup(onProgress: (p: WarmupProgress) => void): Promise<void> {
  const list = steps();
  for (let i = 0; i < list.length; i++) {
    onProgress({ done: i, total: list.length, label: list[i].label });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await list[i].run();
  }
  onProgress({ done: list.length, total: list.length, label: t("load.done") });
}
