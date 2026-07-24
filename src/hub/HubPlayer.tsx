import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Humanoid, IDLE_MOTION, type BodyMotion } from "../game/Humanoid";
import { useKeyboard, usePointerLook } from "../game/input";
import { CAMERA, MOVE, NET_EPSILON, NET_THROTTLE_MS } from "../game/constants";
import { createMotionState, stepMotion } from "../game/movement";
import { createFollowScratch, updateFollowCamera } from "../game/followCamera";
import { NameTag } from "../game/NameTag";
import { HUB, HUB_BOXES, portalAt, type Portal } from "./hubMap";

/** How long you must stand in an arch before it takes you into a match. */
export const PORTAL_DWELL_MS = 1200;

export interface PortalProgress {
  portal: Portal | null;
  /** 0..1 dwell completion. */
  progress: number;
}

interface Props {
  account: string;
  nick: string;
  /** Written every frame; the HUD polls it rather than re-rendering at 60fps. */
  portalRef: React.MutableRefObject<PortalProgress>;
  onEnterPortal: (portal: Portal) => void;
  onTransform: (pos: [number, number, number], rotY: number, moving: boolean) => void;
  /** Suppresses input while a match is being joined. */
  frozen: boolean;
}

export function HubPlayer({
  account,
  nick,
  portalRef,
  onEnterPortal,
  onTransform,
  frozen,
}: Props) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const motion = useRef(createMotionState(HUB.spawn));
  const yaw = useRef(Math.PI); // face the portals, which sit at -Z
  const pitch = useRef(0.2);
  const follow = useRef(createFollowScratch(CAMERA.playDistance));
  const bodyFade = useRef(1);
  const bodyMotion = useRef<BodyMotion>({ ...IDLE_MOTION });

  const dwell = useRef(0);
  const entered = useRef(false);
  const lastSent = useRef({ x: 0, y: 0, z: 0, rot: 0, at: 0 });

  const { read } = useKeyboard();
  usePointerLook(!frozen, MOVE.mouseSensitivity, yaw, pitch);

  useEffect(() => {
    entered.current = false;
    dwell.current = 0;
  }, [frozen]);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    const now = performance.now();
    const input = frozen
      ? { forward: 0, strafe: 0, jump: false }
      : read();

    stepMotion(motion.current, input, yaw.current, {
      boxes: HUB_BOXES,
      dt: step,
      now,
      speed: MOVE.hiderSpeed,
      radius: MOVE.playerRadius,
      worldHalfSize: HUB.size / 2,
    });

    const [px, py, pz] = motion.current.pos;

    const bm = bodyMotion.current;
    bm.moving = motion.current.moving;
    bm.airborne = !motion.current.grounded;
    bm.vy = motion.current.vy;
    bm.speed = Math.hypot(motion.current.vel[0], motion.current.vel[1]);

    if (group.current) {
      group.current.position.set(px, py, pz);
      group.current.rotation.y = yaw.current;
    }

    bodyFade.current = updateFollowCamera(camera, follow.current, {
      pos: motion.current.pos,
      yaw: yaw.current,
      pitch: pitch.current,
      desired: CAMERA.playDistance,
      minDistance: CAMERA.minDistance,
      boxes: HUB_BOXES,
      dt: step,
      shoulderHeight: CAMERA.shoulderHeight,
      eyeHeight: CAMERA.eyeHeight,
      fadeEnd: CAMERA.fadeEnd,
      fadeStart: CAMERA.fadeStart,
      allowFade: true,
    });

    // Portals need a short dwell rather than firing on contact, so brushing past
    // an arch on the way somewhere else doesn't drop you into a match.
    const standing = frozen ? null : portalAt(px, pz);
    if (standing?.available) {
      dwell.current += step * 1000;
      if (dwell.current >= PORTAL_DWELL_MS && !entered.current) {
        entered.current = true;
        onEnterPortal(standing);
      }
    } else {
      dwell.current = 0;
    }
    portalRef.current = {
      portal: standing,
      progress: standing?.available ? Math.min(1, dwell.current / PORTAL_DWELL_MS) : 0,
    };

    const s = lastSent.current;
    const movedEnough =
      Math.abs(px - s.x) > NET_EPSILON.pos ||
      Math.abs(pz - s.z) > NET_EPSILON.pos ||
      Math.abs(py - s.y) > NET_EPSILON.pos;
    const turnedEnough = Math.abs(yaw.current - s.rot) > NET_EPSILON.rot;

    if ((movedEnough || turnedEnough) && now - s.at >= NET_THROTTLE_MS) {
      s.x = px;
      s.y = py;
      s.z = pz;
      s.rot = yaw.current;
      s.at = now;
      onTransform([px, py, pz], yaw.current, motion.current.moving);
    }
  });

  return (
    <group ref={group}>
      <Humanoid account={account} pose={0} motionRef={bodyMotion} showOutline fadeRef={bodyFade} />
      <NameTag text={nick} color="#6fbf5c" />
    </group>
  );
}
