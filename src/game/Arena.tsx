import { ThreeEvent } from "@react-three/fiber";
import { ARENA, FLOOR_COLOR, MAP_BOXES } from "./map";

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

interface Props {
  /** When set, clicking any surface reports its colour (eyedropper). */
  onPickColor?: (color: number) => void;
}

export function Arena({ onPickColor }: Props) {
  const pick = (color: number) => (e: ThreeEvent<MouseEvent>) => {
    if (!onPickColor) return;
    e.stopPropagation();
    onPickColor(color);
  };

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onClick={pick(FLOOR_COLOR)}
      >
        <planeGeometry args={[ARENA.size, ARENA.size]} />
        <meshStandardMaterial color={hex(FLOOR_COLOR)} roughness={0.95} />
      </mesh>

      {MAP_BOXES.map((b, i) => (
        <mesh key={i} position={b.p} castShadow receiveShadow onClick={pick(b.c)}>
          <boxGeometry args={b.s} />
          <meshStandardMaterial color={hex(b.c)} roughness={0.8} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

export function Lighting() {
  return (
    <>
      <hemisphereLight args={["#b9c6d6", "#2a2f38", 0.85]} />
      <directionalLight
        position={[18, 26, 12]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-camera-far={70}
      />
      <ambientLight intensity={0.25} />
      <fog attach="fog" args={["#1a1f28", 30, 62]} />
      <color attach="background" args={["#1a1f28"]} />
    </>
  );
}
