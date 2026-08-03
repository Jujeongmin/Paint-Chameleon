/**
 * Movement basis, kept pure so it can be asserted.
 *
 * This got the sign wrong once — strafing sent you the opposite way — and the
 * mistake is invisible from the code alone, so scripts/check-movement.ts pins
 * the convention down.
 *
 * Convention: yaw 0 faces +Z. The camera sits behind the player looking along
 * that forward vector, and a camera looking down +Z with up +Y has its screen
 * right along world -X. Hence:
 *
 *   forward = ( sin yaw, cos yaw)
 *   right   = (-cos yaw, sin yaw)     // forward x up
 */

import { groundHeightAt, moveXZ, playerTouchingWall, type MapBox } from "./map";
import { MOVE } from "./constants";

export function forwardVector(yaw: number): [number, number] {
  return [Math.sin(yaw), Math.cos(yaw)];
}

export function rightVector(yaw: number): [number, number] {
  return [-Math.cos(yaw), Math.sin(yaw)];
}

/**
 * Desired movement direction from stick/keys, normalised so diagonals aren't
 * faster than the cardinals.
 */
/** Everything the integrator carries between frames. */
export interface MotionState {
  pos: [number, number, number];
  /** Horizontal velocity (x, z). */
  vel: [number, number];
  vy: number;
  grounded: boolean;
  lastGroundedAt: number;
  jumpHeld: boolean;
  /** Stays set after Space is released so an idle player remains attached. */
  wallLatched: boolean;
  moving: boolean;
}

export function createMotionState(pos: [number, number, number]): MotionState {
  return {
    pos: [...pos] as [number, number, number],
    vel: [0, 0],
    vy: 0,
    grounded: true,
    lastGroundedAt: 0,
    jumpHeld: false,
    wallLatched: false,
    moving: false,
  };
}

export interface MotionInput {
  forward: number;
  strafe: number;
  jump: boolean;
}

/**
 * One physics step. Shared by the match and the hub so the walk, the gravity and
 * the step-up behaviour can't drift apart between them.
 *
 * `locked` pins the player completely — used by the in-match pose lock.
 *
 * Returns true on the exact frame a jump launches, so callers can react to the
 * edge (e.g. snapping a held pose back to standing) without polling `grounded`,
 * which would also fire every other way of leaving the ground.
 */
export function stepMotion(
  s: MotionState,
  input: MotionInput,
  yaw: number,
  opts: {
    boxes: MapBox[];
    dt: number;
    now: number;
    speed: number;
    radius: number;
    locked?: boolean;
    /** Half-extent of the enclosing world; the hub is smaller than the arena. */
    worldHalfSize?: number;
    /** Height of the implicit ground plane; the holding cell's is below zero. */
    floorY?: number;
  }
): boolean {
  const { boxes, dt, now, speed, radius } = opts;

  if (opts.locked) {
    s.vel[0] = 0;
    s.vel[1] = 0;
    s.vy = 0;
    s.moving = false;
    s.jumpHeld = input.jump;
    s.wallLatched = false;
    return false;
  }

  const [wishX, wishZ] = wishDirection(yaw, input.forward, input.strafe);

  // Ease toward the wish velocity; snapping straight to it reads as floaty.
  const accel = s.grounded ? MOVE.groundAccel : MOVE.airAccel;
  const k = Math.min(1, dt * accel);
  s.vel[0] += (wishX * speed - s.vel[0]) * k;
  s.vel[1] += (wishZ * speed - s.vel[1]) * k;

  let jumped = false;
  const wasJumpHeld = s.jumpHeld;
  if (input.jump && !wasJumpHeld) {
    const coyote = now - s.lastGroundedAt < MOVE.coyoteMs;
    if (s.grounded || coyote) {
      s.vy = MOVE.jumpSpeed;
      s.grounded = false;
      jumped = true;
    }
  }
  s.jumpHeld = input.jump;

  const next = moveXZ(s.pos, s.vel[0] * dt, s.vel[1] * dt, radius, boxes, opts.worldHalfSize);

  const touchingWall =
    !s.grounded && playerTouchingWall(next[0], next[2], next[1], radius, boxes);
  const movingInput = input.forward !== 0 || input.strafe !== 0;

  // Space climbs continuously while the body touches arena geometry. Letting
  // go leaves the player latched at that exact height, but only while idle:
  // moving after release, or losing contact with the wall, drops immediately.
  if (touchingWall && input.jump && wasJumpHeld) {
    s.wallLatched = true;
    s.vy = MOVE.wallClimbSpeed;
  } else if (touchingWall && s.wallLatched && !movingInput) {
    s.vy = 0;
  } else {
    s.wallLatched = false;
    s.vy -= MOVE.gravity * dt;
  }
  next[1] += s.vy * dt;

  const ground = groundHeightAt(next[0], next[2], next[1], boxes, opts.floorY ?? 0);
  if (next[1] <= ground) {
    next[1] = ground;
    s.vy = 0;
    s.grounded = true;
    s.wallLatched = false;
    s.lastGroundedAt = now;
  } else {
    s.grounded = false;
  }

  s.pos = next;
  s.moving = Math.hypot(s.vel[0], s.vel[1]) > 0.4;
  return jumped;
}

export function wishDirection(yaw: number, forward: number, strafe: number): [number, number] {
  const [fx, fz] = forwardVector(yaw);
  const [rx, rz] = rightVector(yaw);

  let x = fx * forward + rx * strafe;
  let z = fz * forward + rz * strafe;

  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return [x, z];
}
