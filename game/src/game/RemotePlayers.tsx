import { Suspense, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Humanoid, IDLE_MOTION, type BodyMotion } from "./Humanoid";
import { Gun } from "./Gun";
import { NameTag } from "./NameTag";
import { MAP_BOXES, groundHeightAt, type MapBox } from "./map";
import { SEEKER_SCALE } from "./constants";
import type { PlayerState } from "../net/types";

/** Shortest-path angle lerp so crossing ±π doesn't spin the model around. */
function lerpAngle(from: number, to: number, t: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

function RemotePlayer({
  player,
  boxes,
  showName,
  revealed,
  armed,
}: {
  player: PlayerState;
  boxes: MapBox[];
  showName?: boolean;
  revealed?: boolean;
  armed?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const initialised = useRef(false);
  const target = useRef(new THREE.Vector3());
  const previous = useRef(new THREE.Vector3());
  /**
   * Peers only send position, so walk and jump are derived from how their
   * interpolated transform is actually moving. Keeps the wire format small and
   * means their animation can never disagree with where they appear to be.
   */
  const motion = useRef<BodyMotion>({ ...IDLE_MOTION });

  useFrame((_, dt) => {
    if (!group.current) return;
    const step = Math.max(1e-4, Math.min(dt, 0.05));

    target.current.set(player.pos?.[0] ?? 0, player.pos?.[1] ?? 0, player.pos?.[2] ?? 0);
    const trot = player.rotY ?? 0;

    if (!initialised.current) {
      group.current.position.copy(target.current);
      previous.current.copy(target.current);
      group.current.rotation.y = trot;
      initialised.current = true;
      return;
    }

    // Transforms arrive at ~10Hz; smooth toward them rather than snapping.
    const k = Math.min(1, step * 12);
    group.current.position.lerp(target.current, k);
    group.current.rotation.y = lerpAngle(group.current.rotation.y, trot, k);

    const p = group.current.position;
    const dx = p.x - previous.current.x;
    const dy = p.y - previous.current.y;
    const dz = p.z - previous.current.z;
    previous.current.copy(p);

    const speed = Math.hypot(dx, dz) / step;
    const ground = groundHeightAt(p.x, p.z, p.y, boxes);

    const m = motion.current;
    m.speed = speed;
    // Trust the sender's own flag as well — interpolation can briefly stall
    // between packets even while they're walking.
    m.moving = speed > 0.6 || !!player.moving;
    m.airborne = p.y > ground + 0.08;
    m.vy = dy / step;
  });

  return (
    // The shot's raycast hits a mesh several levels down inside Humanoid, so the
    // body has to say whose it is somewhere an ancestor walk can find it.
    // The seeker is drawn at giant scale for everyone; feet stay on the floor
    // because the group's origin is at them.
    <group
      ref={group}
      userData={{ account: player.account }}
      scale={player.role === "seeker" ? SEEKER_SCALE : 1}
    >
      <Humanoid
        account={player.account}
        pose={player.pose ?? 0}
        motionRef={motion}
        dimmed={!!player.caught}
        body={player.body}
        revealed={revealed}
        // Same reasoning as LocalPlayer: the gun gets its own boundary so a
        // slow or failed GLB fetch costs the gun, not the peer's whole body —
        // the outer Suspense in App.tsx wraps the entire scene. The load is
        // shared with the local gun through useLoader's cache, so a hider
        // watching the seeker pays for it once.
        held={
          armed && player.role === "seeker" ? (
            <Suspense fallback={null}>
              <Gun />
            </Suspense>
          ) : undefined
        }
      />
      {showName && <NameTag text={player.nick || "익명"} />}
    </group>
  );
}

interface Props {
  players: PlayerState[];
  selfAccount: string;
  /** Collision set for the world they're standing in; the hub differs. */
  boxes?: MapBox[];
  /** Hub shows who everyone is; a match deliberately does not. */
  showNames?: boolean;
  /**
   * Show the hiders who were never caught through the walls. True only during
   * the results phase — the round is over, so nothing is given away.
   */
  reveal?: boolean;
  /**
   * Put the gun in the remote seeker's hand. True only while the chase is on,
   * mirroring the condition LocalPlayer arms itself under — the seeker holding
   * a blaster in the lobby or on the results screen would be a lie about what
   * they can do right now.
   */
  armed?: boolean;
}

export function RemotePlayers({
  players,
  selfAccount,
  boxes = MAP_BOXES,
  showNames,
  reveal,
  armed,
}: Props) {
  return (
    <>
      {players
        .filter((p) => p.account !== selfAccount && p.pos)
        .map((p) => (
          <RemotePlayer
            key={p.account}
            player={p}
            boxes={boxes}
            showName={showNames}
            armed={armed}
            // Survivors only: the seeker already knows where the people they
            // caught were, and the question this answers is where the rest hid.
            revealed={reveal && p.role !== "seeker" && !p.caught}
          />
        ))}
    </>
  );
}
