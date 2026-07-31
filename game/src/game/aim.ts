import { derive, type BodyProfile } from "./bodies";

/**
 * How far the shoulder swings the gun arm forward while the seeker holds the
 * blaster, in radians. Negative pitches the arm forward and up, the same
 * convention POSES uses (banzai is -2.85). Slightly past horizontal because the
 * shortest arm in the catalogue — bean's 0.47 — needs the lift to keep the gun
 * inside a 70-degree view; see check:bodies for the measured angles.
 *
 * The gun hangs off this joint, so rotating the shoulder rotates the gun's own
 * axes with it. Humanoid negates exactly this value on the hand group to bring
 * the barrel back level, which is one constant used twice rather than two that
 * can drift. Without that negation the barrel points at the sky.
 */
export const AIM_ARM_PITCH = -1.75;

/**
 * Where the gun ends up, in the body's own coordinates: x to the body's right,
 * y above the feet, z forward.
 *
 * The same arithmetic three.js applies to the arm — the hand hangs one arm
 * length below the shoulder pivot, and the pivot's X rotation carries it round
 * — written out so the tracer and check:bodies can ask where the gun is
 * without a scene graph to measure it in.
 */
export function aimHandOffset(profile: BodyProfile): { x: number; y: number; z: number } {
  const armLength = derive(profile).armHalf * 2;
  return {
    // Negative x is the body's right: facing +Z with +Y up, right is
    // forward x up = -X, which is also how movement.ts defines its own right
    // vector. Humanoid mounts the gun on the shoulder at -shoulderX for the
    // same reason — the arm the atlas happens to label armL.
    x: -profile.shoulderX,
    y: profile.shoulderY - armLength * Math.cos(AIM_ARM_PITCH),
    z: -armLength * Math.sin(AIM_ARM_PITCH),
  };
}
