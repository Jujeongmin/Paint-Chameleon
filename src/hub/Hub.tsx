import { NameTag } from "../game/NameTag";
import { RemotePlayers } from "../game/RemotePlayers";
import { HUB, HUB_BOXES, PORTALS, type Portal } from "./hubMap";
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

interface Props {
  account: string;
  nick: string;
  players: PlayerState[];
  portalRef: React.MutableRefObject<PortalProgress>;
  onEnterPortal: (portal: Portal) => void;
  onTransform: (pos: [number, number, number], rotY: number, moving: boolean) => void;
  joining: boolean;
}

export function Hub({
  account,
  nick,
  players,
  portalRef,
  onEnterPortal,
  onTransform,
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

      <HubPlayer
        account={account}
        nick={nick}
        portalRef={portalRef}
        onEnterPortal={onEnterPortal}
        onTransform={onTransform}
        frozen={joining}
      />
      <RemotePlayers players={players} selfAccount={account} boxes={HUB_BOXES} showNames />
    </>
  );
}
