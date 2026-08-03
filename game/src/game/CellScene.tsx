import { useRef } from "react";
import * as THREE from "three";
import { CELL_BOXES } from "./cell";
import { useCameraOccluders } from "./cameraOcclusion";

/**
 * The holding cell, drawn.
 *
 * Flat colours rather than the kit models the arena uses: this is a concrete
 * box, and the only thing in it worth looking at is your own body.
 *
 * No onClick/onPickColor here: the eyedropper (useBrush's pickAt) doesn't go
 * through R3F's event system at all — it raycasts scene.children directly and
 * reads surfaceColor(), which falls back to the mesh's material colour when
 * there's no texture. These slabs have no texture, so their flat colour is
 * already what the eyedropper reports; a click handler would be dead weight
 * duplicating a path that already works.
 */

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

export function CellScene() {
  const occluders = useRef<THREE.Group>(null);
  useCameraOccluders(occluders);
  return (
    <group ref={occluders}>
      {CELL_BOXES.map((b, i) => (
        <mesh key={i} position={b.p} receiveShadow>
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
