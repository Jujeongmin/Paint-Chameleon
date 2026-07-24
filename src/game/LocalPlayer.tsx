import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Humanoid, IDLE_MOTION, type BodyMotion } from "./Humanoid";
import { useKeyboard, usePointerLook } from "./input";
import { MAP_BOXES } from "./map";
import { CAMERA, MOVE, NET_EPSILON, NET_THROTTLE_MS, STAND_POSE, TAG, type Phase } from "./constants";
import { createMotionState, stepMotion } from "./movement";
import { createFollowScratch, updateFollowCamera } from "./followCamera";
import { surfaceFor, type PaintDab } from "./paint";
import { playBrushTick } from "../audio/sound";
import { useBrush, type Tool } from "./useBrush";
import type { PlayerState } from "../net/types";

interface Props {
  me: PlayerState;
  phase: Phase;
  pose: number;
  /** Fires when a jump launches while holding a non-standing pose. */
  onJumpFromPose: () => void;
  /** Movement + look disabled (painting, caught, results, or seeker still blind). */
  frozen: boolean;
  paintMode: boolean;
  /** Character is pinned: position, facing and pose all held. Camera stays free. */
  charLocked: boolean;
  onToggleLock: () => void;
  players: PlayerState[];
  onTransform: (pos: [number, number, number], rotY: number, pose: number, moving: boolean) => void;
  onTag: (target: string) => void;

  // paint
  tool: Tool;
  color: number;
  brushSize: number;
  zoom: number;
  onZoom: (zoom: number) => void;
  onDab: (dab: PaintDab, join: boolean) => void;
  onColorPicked: (color: number) => void;
}

export function LocalPlayer({
  me,
  phase,
  pose,
  onJumpFromPose,
  frozen,
  paintMode,
  charLocked,
  onToggleLock,
  players,
  onTransform,
  onTag,
  tool,
  color,
  brushSize,
  zoom,
  onZoom,
  onDab,
  onColorPicked,
}: Props) {
  const group = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const motion = useRef(
    createMotionState([me.pos?.[0] ?? 0, me.pos?.[1] ?? 0, me.pos?.[2] ?? 0])
  );
  const yaw = useRef(0);
  const pitch = useRef(0.25);
  /** Paint mode orbits the camera without turning the body, so it needs its own angles. */
  const orbitYaw = useRef(0);
  const orbitPitch = useRef(0.15);
  /**
   * Facing is held separately from the camera. Unlocked they track together;
   * locked, the camera keeps orbiting while the body stays exactly as posed.
   */
  const bodyYaw = useRef(0);

  const follow = useRef(createFollowScratch(CAMERA.playDistance));
  const bodyFade = useRef(1);
  /** Fed to the rig every frame; see Humanoid for why this isn't a prop. */
  const bodyMotion = useRef<BodyMotion>({ ...IDLE_MOTION });

  const lastSent = useRef({ x: 0, y: 0, z: 0, rot: 0, pose: -1, at: 0 });
  const lastLocalUV = useRef<{ u: number; v: number } | null>(null);
  const spawnApplied = useRef(false);

  const { read } = useKeyboard((code) => {
    // Hiders only — the seeker's reported facing is what the server checks when
    // resolving a tag, so freezing their body would desync the hit test.
    // Only pin while standing on something; locking mid-air would leave you hovering.
    if (
      code === "KeyR" &&
      !paintMode &&
      me.role !== "seeker" &&
      (motion.current.grounded || charLocked)
    ) {
      onToggleLock();
    }
  });

  const look = usePointerLook(!paintMode && !frozen, MOVE.mouseSensitivity, yaw, pitch);

  // Start the orbit behind the player so entering paint mode isn't disorienting.
  useEffect(() => {
    if (paintMode) {
      orbitYaw.current = yaw.current;
      orbitPitch.current = 0.15;
    }
  }, [paintMode]);

  const handleDab = useCallback(
    (dab: PaintDab, join: boolean) => {
      const surface = surfaceFor(me.account);
      if (join && lastLocalUV.current) surface.stroke(lastLocalUV.current, dab);
      else surface.dab(dab);
      lastLocalUV.current = { u: dab.u, v: dab.v };
      playBrushTick();
      onDab(dab, join);
    },
    [me.account, onDab]
  );

  const sampleBody = useCallback(
    (u: number, v: number) => surfaceFor(me.account).sample(u, v),
    [me.account]
  );

  useBrush({
    active: paintMode,
    bodyRef,
    tool,
    color,
    brushSize,
    onDab: handleDab,
    sampleBody,
    onPick: onColorPicked,
    onOrbit: (dx, dy) => {
      orbitYaw.current -= dx * 0.006;
      orbitPitch.current = THREE.MathUtils.clamp(orbitPitch.current + dy * 0.005, -0.7, 1.2);
    },
    onZoom: (dir) => onZoom(THREE.MathUtils.clamp(zoom - dir * 8, 0, 100)),
  });

  // Adopt the server position once on entry, then again whenever a new round
  // respawns us. Outside those moments the client owns its own position.
  useEffect(() => {
    if (!me.pos || spawnApplied.current) return;
    motion.current = createMotionState([me.pos[0] ?? 0, me.pos[1] ?? 0, me.pos[2] ?? 0]);
    spawnApplied.current = true;
  }, [me.pos]);

  useEffect(() => {
    if (phase !== "hiding") return;
    const spawn = me.pos;
    motion.current = createMotionState([spawn?.[0] ?? 0, spawn?.[1] ?? 0, spawn?.[2] ?? 0]);
    lastSent.current.pose = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Seeker tags by clicking. When we're free-looking rather than pointer-locked,
  // a look-drag must not also count as a tag — so only a click that barely moved does.
  useEffect(() => {
    if (me.role !== "seeker" || phase !== "seeking") return;
    const canvas = document.querySelector("canvas");
    if (!canvas) return;

    let downX = 0;
    let downY = 0;

    const tryTag = () => {
      const [px, , pz] = motion.current.pos;
      const fx = Math.sin(yaw.current);
      const fz = Math.cos(yaw.current);

      let best: string | null = null;
      let bestDist = TAG.maxDistance;
      for (const p of players) {
        if (p.account === me.account || p.role !== "hider" || p.caught || !p.pos) continue;
        const dx = (p.pos[0] ?? 0) - px;
        const dz = (p.pos[2] ?? 0) - pz;
        const d = Math.hypot(dx, dz);
        if (d > bestDist) continue;
        if ((dx / (d || 1)) * fx + (dz / (d || 1)) * fz < TAG.minFacingDot) continue;
        bestDist = d;
        best = p.account;
      }
      if (best) onTag(best);
    };

    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      // Under pointer lock the cursor never moves, so every click is a tag.
      const drift = look.locked.current ? 0 : Math.hypot(e.clientX - downX, e.clientY - downY);
      if (drift <= 6) tryTag();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [me.role, me.account, phase, players, onTag, look]);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    const now = performance.now();
    const held = frozen || charLocked;
    const input = held ? { forward: 0, strafe: 0, jump: false } : read();

    let speed = me.role === "seeker" ? MOVE.seekerSpeed : MOVE.hiderSpeed;
    // Holding a pose other than standing is slow — you commit to being still.
    if (pose !== 0) speed *= 0.35;

    // `locked` fully pins the rig — no velocity, no gravity — which is right
    // for the R-lock (always grounded when it engages) but wrong for the rest
    // of `held`: opening the pose menu or the paint panel mid-air, or being
    // caught while airborne, must not cancel gravity or the player freezes
    // hanging in place. Those cases just get zero input and keep falling.
    const jumped = stepMotion(motion.current, input, yaw.current, {
      boxes: MAP_BOXES,
      dt: step,
      now,
      speed,
      radius: MOVE.playerRadius,
      locked: charLocked,
    });
    // A jump breaks whatever pose you were holding — standing is the only one
    // that makes sense mid-air, and it's the default besides.
    if (jumped && pose !== STAND_POSE) onJumpFromPose();

    if (!charLocked) bodyYaw.current = yaw.current;

    const bm = bodyMotion.current;
    bm.moving = motion.current.moving;
    bm.airborne = !motion.current.grounded;
    bm.vy = motion.current.vy;
    bm.speed = Math.hypot(motion.current.vel[0], motion.current.vel[1]);

    const [px, py, pz] = motion.current.pos;
    if (group.current) {
      group.current.position.set(px, py, pz);
      group.current.rotation.y = bodyYaw.current;
    }

    bodyFade.current = updateFollowCamera(camera, follow.current, {
      pos: motion.current.pos,
      yaw: paintMode ? orbitYaw.current : yaw.current,
      pitch: paintMode ? orbitPitch.current : pitch.current,
      desired: paintMode
        ? THREE.MathUtils.lerp(CAMERA.paintFar, CAMERA.paintNear, zoom / 100)
        : CAMERA.playDistance,
      minDistance: paintMode ? CAMERA.paintMinDistance : CAMERA.minDistance,
      boxes: MAP_BOXES,
      dt: step,
      shoulderHeight: paintMode ? 0.95 : CAMERA.shoulderHeight,
      eyeHeight: paintMode ? 0.95 : CAMERA.eyeHeight,
      fadeEnd: CAMERA.fadeEnd,
      fadeStart: CAMERA.fadeStart,
      allowFade: !paintMode,
    });

    // Network: only send when something actually changed. Peers render our body,
    // so they get bodyYaw — for the seeker that always equals the camera yaw,
    // which is what the server's tag facing test needs.
    const s = lastSent.current;
    const movedEnough =
      Math.abs(px - s.x) > NET_EPSILON.pos ||
      Math.abs(pz - s.z) > NET_EPSILON.pos ||
      Math.abs(py - s.y) > NET_EPSILON.pos;
    const turnedEnough = Math.abs(bodyYaw.current - s.rot) > NET_EPSILON.rot;
    const posedDifferently = pose !== s.pose;

    if ((movedEnough || turnedEnough || posedDifferently) && now - s.at >= NET_THROTTLE_MS) {
      s.x = px;
      s.y = py;
      s.z = pz;
      s.rot = bodyYaw.current;
      s.pose = pose;
      s.at = now;
      onTransform([px, py, pz], bodyYaw.current, pose, motion.current.moving);
    }
  });

  return (
    <group ref={group}>
      <group ref={bodyRef}>
        <Humanoid
          account={me.account}
          pose={pose}
          motionRef={bodyMotion}
          showOutline={!paintMode}
          dimmed={me.caught}
          fadeRef={bodyFade}
        />
      </group>
    </group>
  );
}
