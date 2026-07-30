import { useEffect, useRef, useState } from "react";

const TUTORIAL_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

/** Total mouse travel that counts as "they found the look control", in pixels. */
const LOOK_TRAVEL_PX = 150;

/**
 * True once the player has demonstrably worked out the controls, so the HUD can
 * drop the tutorial.
 *
 * Pointer lock alone isn't a usable signal: it's blocked inside an iframe
 * without `allow="pointer-lock"`, which is how this game gets embedded, so for
 * many players it would never fire and the tutorial would never leave. Actual
 * input is the reliable tell.
 *
 * Latches on — once learned it stays learned for the session, so walking
 * between the hub and a match doesn't bring the tutorial back.
 */
export function useControlsLearned(): boolean {
  const [learned, setLearned] = useState(false);

  useEffect(() => {
    if (learned) return;

    let travel = 0;

    const onKey = (e: KeyboardEvent) => {
      if (TUTORIAL_KEYS.has(e.code)) setLearned(true);
    };
    const onMove = (e: MouseEvent) => {
      // Require real travel; an incidental nudge shouldn't count as learning.
      travel += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (travel >= LOOK_TRAVEL_PX) setLearned(true);
    };
    const onLockChange = () => {
      if (document.pointerLockElement) setLearned(true);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
  }, [learned]);

  return learned;
}

export interface InputState {
  forward: number;
  strafe: number;
  jump: boolean;
}

const FORWARD_KEYS = ["KeyW", "ArrowUp"];
const BACK_KEYS = ["KeyS", "ArrowDown"];
const LEFT_KEYS = ["KeyA", "ArrowLeft"];
const RIGHT_KEYS = ["KeyD", "ArrowRight"];

/** Tracks raw key state plus one-shot presses the game polls each frame. */
export function useKeyboard(onPress?: (code: string) => void) {
  const held = useRef<Record<string, boolean>>({});
  const pressHandler = useRef(onPress);
  pressHandler.current = onPress;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      held.current[e.code] = true;
      pressHandler.current?.(e.code);
    };
    const up = (e: KeyboardEvent) => {
      held.current[e.code] = false;
    };
    const blur = () => {
      held.current = {};
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const read = (): InputState => {
    const k = held.current;
    const any = (list: string[]) => list.some((c) => k[c]);
    return {
      forward: (any(FORWARD_KEYS) ? 1 : 0) - (any(BACK_KEYS) ? 1 : 0),
      strafe: (any(RIGHT_KEYS) ? 1 : 0) - (any(LEFT_KEYS) ? 1 : 0),
      jump: !!k.Space,
    };
  };

  return { read, held };
}

let lockRefusalReported = false;

/**
 * Pointer lock being refused is invisible — no error surfaces anywhere — and it
 * decides whether the cursor can be pinned to the centre. Say so once, with the
 * usual cause, so it isn't mistaken for a bug in the look controls.
 */
function reportLockRefused(): void {
  if (lockRefusalReported || !import.meta.env.DEV) return;
  lockRefusalReported = true;

  const framed = window.self !== window.top;
  console.warn(
    "[input] Pointer lock refused — the cursor can't be pinned to the centre, " +
      "so looking around stops at the screen edge. Falling back to free look." +
      (framed
        ? "\nThis page is inside an iframe; pointer lock needs allow=\"pointer-lock\" on it. " +
          "Open http://localhost:" +
          location.port +
          " directly in a browser tab to get proper mouse look."
        : "\nNot in an iframe — the browser or an extension is blocking it.")
  );
}

export interface LookState {
  /** Pointer lock is currently held. */
  locked: React.MutableRefObject<boolean>;
  /**
   * Pointer lock has succeeded at least once this activation. Distinguishes a
   * momentary loss of lock (Esc, then a click that's already recapturing it)
   * from an environment where lock has never worked at all (an iframe missing
   * allow="pointer-lock") and free look is this player's permanent mode.
   */
  everLocked: React.MutableRefObject<boolean>;
}

/**
 * Mouse look.
 *
 * Pointer lock is the better experience — the cursor never runs out of screen —
 * but it is blocked inside an iframe that lacks `allow="pointer-lock"`, which is
 * exactly how this game gets embedded on verse8. So it is attempted, and when
 * refused we fall back to free look: raw mousemove deltas, no button held.
 *
 * The fallback only reacts while the cursor is over the canvas, otherwise
 * reaching for a HUD button would spin the camera on the way there.
 *
 * Lock is attempted on mount, which lands right after the join click while the
 * document still has activation, and again on every click on the canvas. The
 * mount attempt is what stops the player spawning unlocked and having to
 * discover that clicking the world is what captures the mouse; the click
 * attempts are what let them get it back after Esc.
 *
 * Refusals are never cached — see tryLock.
 *
 * Deltas accumulate into refs the render loop reads; routing them through React
 * state would re-render at pointer rate.
 */
export function usePointerLook(
  enabled: boolean,
  sensitivity: number,
  yaw: React.MutableRefObject<number>,
  pitch: React.MutableRefObject<number>
): LookState {
  const locked = useRef(false);
  /** Once lock has worked, a later refusal is transient, not environmental. */
  const everLocked = useRef(false);

  useEffect(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;

    if (!enabled) {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      return;
    }

    const applyDelta = (mx: number, my: number) => {
      // A tab-out or window jump can deliver an enormous delta; ignore those
      // rather than whipping the camera around.
      if (Math.abs(mx) > 200 || Math.abs(my) > 200) return;
      yaw.current -= mx * sensitivity;
      pitch.current = Math.max(-0.6, Math.min(1.1, pitch.current + my * sensitivity));
    };

    const onMove = (e: MouseEvent) => {
      if (locked.current) {
        applyDelta(e.movementX, e.movementY);
        return;
      }
      // Free look: no button needed, but only while the cursor is on the canvas
      // so moving toward a HUD button doesn't drag the view with it.
      if (e.target !== canvas) return;
      applyDelta(e.movementX, e.movementY);
    };

    // True while an automatic (non-gesture) attempt is in flight, so its
    // failure doesn't print a warning about a browser that refused nothing.
    let auto = false;

    const refuse = () => {
      if (auto) {
        auto = false;
        return;
      }
      // Don't cry "this browser blocks pointer lock" over the refusal that
      // follows an Esc — lock demonstrably works here, it's just cooling down.
      if (everLocked.current) return;
      reportLockRefused();
    };

    /**
     * Ask for lock. Never gives up permanently.
     *
     * A refusal is not durable information. Chrome blocks re-locking for a
     * moment after the user leaves lock with Esc, so the very next click is
     * refused even though clicking is exactly the gesture that should restore
     * it. Latching that first refusal into "this browser can't do pointer
     * lock" killed every later attempt for the rest of the session: press Esc
     * once and the mouse could never be recaptured.
     *
     * So every canvas click tries again. In an environment that truly forbids
     * it (an iframe without allow="pointer-lock") the attempts simply keep
     * failing, which costs nothing — and reportLockRefused only ever logs once.
     */
    const tryLock = (fromGesture: boolean) => {
      if (locked.current || document.pointerLockElement === canvas) return;
      auto = !fromGesture;
      const result = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === "function") result.catch(refuse);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      tryLock(true);
    };

    const onLockChange = () => {
      locked.current = document.pointerLockElement === canvas;
      if (locked.current) {
        auto = false;
        everLocked.current = true;
      }
    };
    const onLockError = () => {
      locked.current = false;
      refuse();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror", onLockError);
    canvas.addEventListener("pointerdown", onPointerDown);

    // Right after the join click, while the document still has activation.
    tryLock(false);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, [enabled, sensitivity, yaw, pitch]);

  return { locked, everLocked };
}
