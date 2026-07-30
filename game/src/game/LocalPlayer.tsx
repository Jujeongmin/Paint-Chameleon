import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Humanoid, IDLE_MOTION, type BodyMotion } from "./Humanoid";
import { useKeyboard, usePointerLook } from "./input";
import { MAP_BOXES } from "./map";
import { CELL_BOXES, CELL_FLOOR_Y, CELL_HALF, CELL_SPAWN, HUNT_START } from "./cell";
import { CAMERA, MOVE, NET_EPSILON, NET_THROTTLE_MS, STAND_POSE, type Phase } from "./constants";
import { createMotionState, stepMotion } from "./movement";
import { createFollowScratch, updateFollowCamera } from "./followCamera";
import { surfaceFor, type PaintDab } from "./paint";
import { playBrushTick } from "../audio/sound";
import { useBrush, type Tool } from "./useBrush";
import { useShoot, type ShotResult } from "./useShoot";
import type { PlayerState } from "../net/types";

interface Props {
  me: PlayerState;
  phase: Phase;
  pose: number;
  /** Equipped body profile id; see `bodies.ts`. */
  body?: string;
  /** Fires when a jump launches while holding a non-standing pose. */
  onJumpFromPose: () => void;
  /** Movement + look disabled (painting, caught, results, or seeker still blind). */
  frozen: boolean;
  /** True while the seeker waits out the hiding phase underground. */
  inCell: boolean;
  paintMode: boolean;
  /** Character is pinned: position, facing and pose all held. Camera stays free. */
  charLocked: boolean;
  onToggleLock: () => void;
  onTransform: (pos: [number, number, number], rotY: number, pose: number, moving: boolean) => void;
  onShoot: (result: ShotResult) => void;

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
  body,
  onJumpFromPose,
  frozen,
  inCell,
  paintMode,
  charLocked,
  onToggleLock,
  onTransform,
  onShoot,
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
  /** Distinguishes the [inCell] effect's mount-time run from a genuine transition. */
  const cellEffectRan = useRef(false);

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

  usePointerLook(!paintMode && !frozen, MOVE.mouseSensitivity, yaw, pitch);

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

  // Entering and leaving the cell are both teleports. The local rig owns its
  // own position, so it has to be told; waiting for the server's write to
  // arrive would leave the body a frame or more inside the wrong world.
  //
  // useEffect runs on mount too, not just on a real change to `inCell` — and
  // LocalPlayer mounts during the lobby, right after the spawnApplied effect
  // above has just adopted the real spawn the server assigned on join. An
  // unguarded snap here would stomp that with [0, 0, 0] on every mount,
  // teleporting every player (hiders included) to the exact arena centre for
  // the whole lobby — visible and functional, since movement isn't frozen
  // then. So the mount case is only allowed to snap if we're already inCell:
  // that's a player joining or reloading mid-hiding-phase as the seeker, who
  // the server has not placed in the cell yet and genuinely needs the snap.
  // Every later change, in either direction, still snaps unconditionally.
  useEffect(() => {
    const firstRun = !cellEffectRan.current;
    cellEffectRan.current = true;
    if (firstRun && !inCell) return;

    motion.current = createMotionState(
      inCell ? ([...CELL_SPAWN] as [number, number, number]) : ([...HUNT_START] as [number, number, number])
    );
    lastSent.current.pose = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCell]);

  // Aim and fire. The candidate search this replaced picked the nearest hider
  // inside a 2.6u cone; a hitscan has no candidates — whatever the crosshair
  // is on is the answer, and the server no longer measures distance at all.
  //
  // Painting also listens for pointerdown on this canvas, so the gun must stay
  // off while paintMode is active — otherwise every brush stroke would burn
  // the shot cooldown and could kill a hider down the crosshair by accident.
  useShoot({
    active: me.role === "seeker" && phase === "seeking" && !frozen && !paintMode,
    selfAccount: me.account,
    onFire: onShoot,
  });

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
      boxes: inCell ? CELL_BOXES : MAP_BOXES,
      dt: step,
      now,
      speed,
      radius: MOVE.playerRadius,
      locked: charLocked,
      worldHalfSize: inCell ? CELL_HALF : undefined,
      floorY: inCell ? CELL_FLOOR_Y : 0,
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
      boxes: inCell ? CELL_BOXES : MAP_BOXES,
      dt: step,
      shoulderHeight: paintMode ? 0.95 : CAMERA.shoulderHeight,
      eyeHeight: paintMode ? 0.95 : CAMERA.eyeHeight,
      fadeEnd: CAMERA.fadeEnd,
      fadeStart: CAMERA.fadeStart,
      allowFade: !paintMode,
      floorY: inCell ? CELL_FLOOR_Y : 0,
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
      {/* useShoot's ancestor walk must be able to recognise this as our own
          body and skip it — in third person the seeker's own torso sits
          between the camera and everything else, so without this tag every
          shot would register as a point-blank miss into ourselves. Nothing
          local reads this userData; it exists purely for that raycast. */}
      <group ref={bodyRef} userData={{ account: me.account }}>
        <Humanoid
          account={me.account}
          pose={pose}
          body={body}
          motionRef={bodyMotion}
          showOutline={!paintMode}
          dimmed={me.caught}
          fadeRef={bodyFade}
        />
      </group>
    </group>
  );
}
