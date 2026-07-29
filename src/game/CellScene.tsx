import { ThreeEvent } from "@react-three/fiber";
import { CELL_BOXES } from "./cell";

/**
 * The holding cell, drawn.
 *
 * Flat colours rather than the kit models the arena uses: this is a concrete
 * box, and the only thing in it worth looking at is your own body.
 */

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

interface Props {
  onPickColor?: (color: number) => void;
}

export function CellScene({ onPickColor }: Props) {
  const pick = (color: number) => (e: ThreeEvent<MouseEvent>) => {
    if (!onPickColor) return;
    e.stopPropagation();
    onPickColor(color);
  };

  return (
    <group>
      {CELL_BOXES.map((b, i) => (
        <mesh key={i} position={b.p} receiveShadow onClick={pick(b.c)}>
          <boxGeometry args={b.s} />
          <meshStandardMaterial color={hex(b.c)} roughness={0.95} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}

/** Lighting for a windowless room: one soft overhead, no sun, no fog. */
export function CellLighting() {
  return (
    <>
      <hemisphereLight args={["#cfd6de", "#2a2f38", 0.9]} />
      <ambientLight intensity={0.5} />
      <color attach="background" args={["#05070a"]} />
    </>
  );
}
