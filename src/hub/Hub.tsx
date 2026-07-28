import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { NameTag } from "../game/NameTag";
import { RemotePlayers } from "../game/RemotePlayers";
import { Humanoid, IDLE_MOTION } from "../game/Humanoid";
import { HUB, HUB_BOXES, PORTALS, SHOP, STAND, STANDS, type Portal, type Stand } from "./hubMap";
import { HubPlayer, type PortalProgress } from "./HubPlayer";
import type { PlayerState } from "../net/types";

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

function HubLighting() {
  return (
    <>
      <hemisphereLight args={["#dff0ff", "#8e8b84", 1.05]} />
      <directionalLight
        position={[14, 24, 16]}
        intensity={1.35}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-far={64}
      />
      <ambientLight intensity={0.35} />
      <fog attach="fog" args={["#bcd6ea", 40, 78]} />
      <color attach="background" args={["#bcd6ea"]} />
    </>
  );
}

function PortalArch({ portal }: { portal: Portal }) {
  const dim = portal.available ? 1 : 0.45;

  return (
    <group position={[portal.x, 0, portal.z]}>
      {/* The doorway itself — a flat panel standing in the arch. */}
      <mesh position={[0, 2.1, 0]}>
        <planeGeometry args={[3.6, 3.4]} />
        <meshStandardMaterial
          color={portal.available ? "#2f8f8a" : "#4a4d55"}
          emissive={portal.available ? "#173f3d" : "#000000"}
          roughness={0.6}
          side={2}
        />
      </mesh>

      {/* Trigger footprint, so it's obvious where to stand. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.9]}>
        <circleGeometry args={[portal.triggerRadius, 32]} />
        <meshStandardMaterial
          color={hex(portal.color)}
          transparent
          opacity={0.28 * dim}
          roughness={1}
        />
      </mesh>

      <NameTag text={portal.label} y={5.5} height={0.52} color={hex(portal.color)} />
      {portal.sub && <NameTag text={portal.sub} y={4.95} height={0.4} color="#ffffff" />}
    </group>
  );
}

/**
 * One avatar on a turntable, with the trigger circle you stand in to buy it
 * drawn on the floor in front. Full size, so the preview is the same body
 * you'd be walking around in — no separate preview canvas to keep in sync
 * with the real renderer.
 */
function Mannequin({ stand, equipped }: { stand: Stand; equipped: boolean }) {
  const group = useRef<THREE.Group>(null);
  const motion = useRef({ ...IDLE_MOTION });

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.5;
  });

  return (
    <>
      <group position={[stand.x, 0.3, stand.z]}>
        {/* Plinth, so they read as display pieces rather than idle players. */}
        <mesh position={[0, -0.15, 0]} receiveShadow>
          <cylinderGeometry args={[0.62, 0.62, 0.3, 20]} />
          <meshStandardMaterial color={hex(SHOP.color)} roughness={0.7} />
        </mesh>
        <group ref={group}>
          {/* A reserved surface key: real accounts never contain a colon. */}
          <Humanoid account={`__shop:${stand.id}`} pose={0} body={stand.id} motionRef={motion} />
        </group>
        <NameTag text={stand.name} y={2.3} height={0.4} color="#ffffff" />
      </group>

      {/* Trigger footprint, so it's obvious where to stand — same treatment
          PortalArch gives its own trigger. The equipped stand gets the accent
          colour so the body you're already wearing is findable at a glance. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[stand.tx, 0.02, stand.tz]}
        receiveShadow
      >
        <circleGeometry args={[STAND.triggerRadius, 28]} />
        <meshStandardMaterial
          color={equipped ? "#6fbf5c" : hex(SHOP.color)}
          transparent
          opacity={equipped ? 0.45 : 0.28}
          roughness={1}
        />
      </mesh>
    </>
  );
}

function ShopStand({ equippedBody }: { equippedBody: string | undefined }) {
  return (
    <>
      {/* NameTag renders at [0, y, 0] in its PARENT's space, so the sign needs
          its own positioned group — exactly how PortalArch places its labels. */}
      <group position={[SHOP.x, 0, SHOP.z]}>
        <NameTag text="아바타 상점" y={3.6} height={0.52} color={hex(SHOP.color)} />
      </group>
      {STANDS.map((s) => (
        <Mannequin key={s.id} stand={s} equipped={s.id === equippedBody} />
      ))}
    </>
  );
}

interface Props {
  account: string;
  nick: string;
  /** Equipped body profile id; see `bodies.ts`. */
  body?: string;
  players: PlayerState[];
  portalRef: React.MutableRefObject<PortalProgress>;
  onEnterPortal: (portal: Portal) => void;
  onTransform: (pos: [number, number, number], rotY: number, moving: boolean) => void;
  /** Written every frame by HubPlayer with the shop stand underfoot. */
  standRef: React.MutableRefObject<Stand | null>;
  joining: boolean;
}

export function Hub({
  account,
  nick,
  body,
  players,
  portalRef,
  onEnterPortal,
  onTransform,
  standRef,
  joining,
}: Props) {
  return (
    <>
      <HubLighting />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[HUB.size, HUB.size]} />
        <meshStandardMaterial color={hex(HUB.floorColor)} roughness={0.95} />
      </mesh>

      {/* Carpet leading from the spawn point to the portals. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[9, 24]} />
        <meshStandardMaterial color={hex(HUB.carpetColor)} roughness={0.9} />
      </mesh>

      {HUB_BOXES.map((b, i) => (
        <mesh key={i} position={b.p} castShadow receiveShadow>
          <boxGeometry args={b.s} />
          <meshStandardMaterial color={hex(b.c)} roughness={0.8} />
        </mesh>
      ))}

      {PORTALS.map((p) => (
        <PortalArch key={p.id} portal={p} />
      ))}

      <ShopStand equippedBody={body} />

      <HubPlayer
        account={account}
        nick={nick}
        body={body}
        portalRef={portalRef}
        onEnterPortal={onEnterPortal}
        onTransform={onTransform}
        standRef={standRef}
        frozen={joining}
      />
      <RemotePlayers players={players} selfAccount={account} boxes={HUB_BOXES} showNames />
    </>
  );
}
