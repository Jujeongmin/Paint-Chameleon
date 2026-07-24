import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { packUVs, surfaceFor, type BodyPart } from "./paint";
import { MOVE, POSES } from "./constants";

/**
 * Chunky white figure. Deliberately simple: broad, flat-ish panels give the
 * brush somewhere to land and keep the silhouette readable at distance.
 *
 * Limbs hang inside pivot groups placed at the shoulder and hip, with the mesh
 * offset down by half its length. Rotating the mesh directly would spin it
 * about its own middle, which is invisible on a small walk swing but obviously
 * wrong the moment a pose throws the arms overhead.
 *
 * Every part clones its own geometry — packUVs rewrites UVs in place, so two
 * parts sharing a geometry would fight over the same texture cell.
 */

const SHOULDER_Y = 1.28;
const ARM_HALF = 0.27;
const HIP_Y = 0.7;
const LEG_HALF = 0.285;

/** Live locomotion state, read once per frame. */
export interface BodyMotion {
  moving: boolean;
  airborne: boolean;
  /** Vertical velocity — separates the rise of a jump from the fall. */
  vy: number;
  /** Horizontal speed, scales how fast the legs cycle. */
  speed: number;
}

export const IDLE_MOTION: BodyMotion = { moving: false, airborne: false, vy: 0, speed: 0 };

/** Airborne limb targets: [legPitch, armPitch]. */
const JUMP_RISE: [number, number] = [-0.8, -2.4];
const JUMP_FALL: [number, number] = [0.4, -0.5];

interface Props {
  account: string;
  pose: number;
  /**
   * Live motion, read per-frame. Passed as a ref because it changes every frame
   * — as a prop it would only update when React happened to re-render, which
   * made the walk cycle stutter and lag behind the actual movement.
   */
  motionRef?: React.MutableRefObject<BodyMotion>;
  dimmed?: boolean;
  /** Faint wireframe so you can pick yourself out in third person. */
  showOutline?: boolean;
  /** 0..1 solidity, driven per-frame by camera proximity. Also a ref. */
  fadeRef?: React.MutableRefObject<number>;
}

export function Humanoid({ account, pose, motionRef, dimmed, showOutline, fadeRef }: Props) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const shoulderL = useRef<THREE.Group>(null);
  const shoulderR = useRef<THREE.Group>(null);
  const hipL = useRef<THREE.Group>(null);
  const hipR = useRef<THREE.Group>(null);

  const gait = useRef(0);
  const gaitAmount = useRef(0);
  const airAmount = useRef(0);
  const squash = useRef(0);
  const wasAirborne = useRef(false);

  const surface = surfaceFor(account);

  const geoms = useMemo(() => {
    const make = (geometry: THREE.BufferGeometry, part: BodyPart) => {
      packUVs(geometry, part);
      return geometry;
    };
    return {
      head: make(new THREE.SphereGeometry(0.34, 24, 18), "head"),
      torso: make(new THREE.CapsuleGeometry(0.26, 0.34, 6, 18), "torso"),
      armL: make(new THREE.CapsuleGeometry(0.1, 0.34, 4, 12), "armL"),
      armR: make(new THREE.CapsuleGeometry(0.1, 0.34, 4, 12), "armR"),
      legL: make(new THREE.CapsuleGeometry(0.125, 0.32, 4, 12), "legL"),
      legR: make(new THREE.CapsuleGeometry(0.125, 0.32, 4, 12), "legR"),
    };
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: surface.texture,
        roughness: 0.82,
        metalness: 0.02,
      }),
    [surface]
  );

  useEffect(() => {
    return () => {
      Object.values(geoms).forEach((g) => g.dispose());
      material.dispose();
    };
  }, [geoms, material]);

  const spec = POSES[THREE.MathUtils.clamp(pose | 0, 0, POSES.length - 1)];

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    const k = Math.min(1, step * 9);
    const m = motionRef?.current ?? IDLE_MOTION;

    // Caught players ghost out; the local body also dissolves as the camera is
    // forced in. Transparent surfaces must stop writing depth or they punch
    // holes in whatever is drawn behind them.
    const alpha = (dimmed ? 0.35 : 1) * (fadeRef?.current ?? 1);
    if (Math.abs(material.opacity - alpha) > 0.002) {
      material.opacity = alpha;
      material.transparent = alpha < 0.995;
      material.depthWrite = alpha >= 0.995;
    }
    if (root.current) root.current.visible = alpha > 0.02;

    // --- walk cycle. Frequency follows actual speed so the feet don't skate.
    const walking = m.moving && !m.airborne;
    const rate = THREE.MathUtils.clamp(m.speed / MOVE.hiderSpeed, 0.35, 1.5);
    if (walking) gait.current += step * 9 * rate;
    gaitAmount.current += ((walking ? 1 : 0) - gaitAmount.current) * Math.min(1, step * 10);

    const swing = Math.sin(gait.current) * 0.62 * gaitAmount.current;
    const liftL = Math.max(0, Math.sin(gait.current)) * 0.06 * gaitAmount.current;
    const liftR = Math.max(0, Math.sin(gait.current + Math.PI)) * 0.06 * gaitAmount.current;

    // --- jump. Rising tucks the legs, falling reaches for the ground.
    airAmount.current += ((m.airborne ? 1 : 0) - airAmount.current) * Math.min(1, step * 14);
    const rising = THREE.MathUtils.clamp(m.vy / MOVE.jumpSpeed, 0, 1);
    const air = airAmount.current;
    const airLeg = THREE.MathUtils.lerp(JUMP_FALL[0], JUMP_RISE[0], rising);
    const airArm = THREE.MathUtils.lerp(JUMP_FALL[1], JUMP_RISE[1], rising);

    // --- landing squash, triggered on touchdown and decaying away.
    if (wasAirborne.current && !m.airborne) squash.current = 1;
    wasAirborne.current = m.airborne;
    squash.current = Math.max(0, squash.current - step * 5);
    const squashEase = squash.current * squash.current;

    if (root.current) {
      const bob = walking ? Math.abs(Math.sin(gait.current)) * 0.045 * gaitAmount.current : 0;
      root.current.scale.y += (spec.scaleY * (1 - squashEase * 0.22) - root.current.scale.y) * k;
      const widen = 1 + squashEase * 0.14;
      root.current.scale.x += (widen - root.current.scale.x) * k;
      root.current.scale.z += (widen - root.current.scale.z) * k;

      // Lean into the walk a little; it reads as intent rather than sliding.
      const lean = spec.pitch + gaitAmount.current * 0.12 - air * 0.1;
      root.current.rotation.x += (lean - root.current.rotation.x) * k;
      root.current.position.y += (spec.lift + bob - root.current.position.y) * k;
    }

    if (head.current) {
      // Counter-bob keeps the head steadier than the body, like a real gait.
      const nod = walking ? Math.sin(gait.current * 2) * 0.03 * gaitAmount.current : 0;
      head.current.position.y += (1.52 + nod - head.current.position.y) * k;
    }
    if (torso.current) {
      const twist = walking ? Math.sin(gait.current) * 0.08 * gaitAmount.current : 0;
      torso.current.rotation.y += (twist - torso.current.rotation.y) * k;
    }

    // Arms: pose sets the resting angle, the walk swings around it, and being
    // airborne overrides both.
    const armPitchL = THREE.MathUtils.lerp(spec.armPitch + swing, airArm, air);
    const armPitchR = THREE.MathUtils.lerp(spec.armPitch - swing, airArm, air);
    if (shoulderL.current) {
      shoulderL.current.rotation.x += (armPitchL - shoulderL.current.rotation.x) * k;
      // Mirrored: positive spread pushes each arm away from the body.
      shoulderL.current.rotation.z += (-spec.armSpread - shoulderL.current.rotation.z) * k;
    }
    if (shoulderR.current) {
      shoulderR.current.rotation.x += (armPitchR - shoulderR.current.rotation.x) * k;
      shoulderR.current.rotation.z += (spec.armSpread - shoulderR.current.rotation.z) * k;
    }

    const legPitchL = THREE.MathUtils.lerp(spec.legPitch - swing * 0.85, airLeg, air);
    const legPitchR = THREE.MathUtils.lerp(spec.legPitch + swing * 0.85, airLeg, air);
    if (hipL.current) {
      hipL.current.rotation.x += (legPitchL - hipL.current.rotation.x) * k;
      hipL.current.position.x += (-0.16 * spec.legSpread - hipL.current.position.x) * k;
      hipL.current.position.y += (HIP_Y + liftL - hipL.current.position.y) * k;
    }
    if (hipR.current) {
      hipR.current.rotation.x += (legPitchR - hipR.current.rotation.x) * k;
      hipR.current.position.x += (0.16 * spec.legSpread - hipR.current.position.x) * k;
      hipR.current.position.y += (HIP_Y + liftR - hipR.current.position.y) * k;
    }
  });

  return (
    <group ref={root} name="humanoid">
      <mesh ref={head} geometry={geoms.head} material={material} position={[0, 1.52, 0]} castShadow />
      <mesh ref={torso} geometry={geoms.torso} material={material} position={[0, 0.98, 0]} castShadow />

      <group ref={shoulderL} position={[-0.35, SHOULDER_Y, 0]}>
        <mesh geometry={geoms.armL} material={material} position={[0, -ARM_HALF, 0]} castShadow />
      </group>
      <group ref={shoulderR} position={[0.35, SHOULDER_Y, 0]}>
        <mesh geometry={geoms.armR} material={material} position={[0, -ARM_HALF, 0]} castShadow />
      </group>

      <group ref={hipL} position={[-0.16, HIP_Y, 0]}>
        <mesh geometry={geoms.legL} material={material} position={[0, -LEG_HALF, 0]} castShadow />
      </group>
      <group ref={hipR} position={[0.16, HIP_Y, 0]}>
        <mesh geometry={geoms.legR} material={material} position={[0, -LEG_HALF, 0]} castShadow />
      </group>

      {showOutline && (
        <mesh position={[0, 0.95, 0]} scale={[0.62, 1.05, 0.45]}>
          <sphereGeometry args={[1, 14, 10]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.1} />
        </mesh>
      )}
    </group>
  );
}
