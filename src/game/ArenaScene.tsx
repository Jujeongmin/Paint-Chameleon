import { useMemo } from "react";
import { ThreeEvent, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ARENA, FLOOR_COLOR, MAP_BOXES, WALL_COLOR, type MapBox } from "./map";

/**
 * The arena, drawn.
 *
 * Structure (floor, perimeter walls) is textured; props are flat two-tone and
 * must stay that way. A prop is a thing a hider paints themselves to look like,
 * and paint is flat colour — a photographic drum is a drum nobody can imitate.
 * See public/README.md.
 *
 * Textured meshes carry `userData.pickColor` because the eyedropper reads a
 * material colour, and a textured material's colour has to be white or it would
 * tint the map (see materialColor in useBrush.ts).
 */

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

/** World units one tile of a surface texture spans. */
const TILE = 4;

/**
 * Colour, normal and roughness for each textured surface, in one flat list so a
 * single useLoader call covers them and the scene suspends exactly once.
 *
 * Loaded through R3F's own useLoader rather than drei's useTexture: importing
 * drei pulls a second pre-bundled copy of @react-three/fiber into the dev
 * server, and the hooks in it don't see this canvas's store — it fails with
 * "Invalid hook call", which reads like a mistake in this file and isn't.
 */
const TEXTURE_URLS = [
  "/textures/floor_color.jpg",
  "/textures/floor_normal.jpg",
  "/textures/floor_rough.jpg",
  "/textures/wall_color.jpg",
  "/textures/wall_normal.jpg",
  "/textures/wall_rough.jpg",
] as const;

type Maps = Record<"map" | "normalMap" | "roughnessMap", THREE.Texture>;

/**
 * useLoader caches by URL, so every consumer gets the same Texture object.
 * Repeat lives on the texture rather than the material, so tiling one surface
 * would retile every other surface sharing the file — hence the clone.
 */
function tiled(source: Maps, repeatX: number, repeatY: number, anisotropy: number): Maps {
  const out = {} as Maps;
  for (const key of ["map", "normalMap", "roughnessMap"] as const) {
    const t = source[key].clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = anisotropy;
    // Only the colour map is authored in sRGB; normals and roughness are data.
    t.colorSpace = key === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    out[key] = t;
  }
  return out;
}

interface Props {
  /** When set, clicking any surface reports its colour (eyedropper). */
  onPickColor?: (color: number) => void;
}

export function Arena({ onPickColor }: Props) {
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const anisotropy = Math.min(8, maxAnisotropy);

  const loaded = useLoader(THREE.TextureLoader, TEXTURE_URLS as unknown as string[]);
  const [floorSource, wallSource] = useMemo(() => {
    const group = (i: number): Maps => ({
      map: loaded[i],
      normalMap: loaded[i + 1],
      roughnessMap: loaded[i + 2],
    });
    return [group(0), group(3)];
  }, [loaded]);

  const floor = useMemo(
    () => tiled(floorSource, ARENA.size / TILE, ARENA.size / TILE, anisotropy),
    [floorSource, anisotropy]
  );

  const walls = useMemo(() => MAP_BOXES.filter((b) => b.wall), []);
  const props = useMemo(() => MAP_BOXES.filter((b) => !b.wall), []);

  // One material per wall: a box's faces are metres apart in size, so a shared
  // repeat would stretch the texture differently on each of them.
  const wallMaterials = useMemo(
    () =>
      walls.map((b) => {
        const across = Math.max(b.s[0], b.s[2]);
        return new THREE.MeshStandardMaterial({
          ...tiled(wallSource, across / TILE, b.s[1] / TILE, anisotropy),
          roughness: 1,
          metalness: 0.05,
        });
      }),
    [walls, wallSource, anisotropy]
  );

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
        userData={{ pickColor: FLOOR_COLOR }}
        onClick={pick(FLOOR_COLOR)}
      >
        <planeGeometry args={[ARENA.size, ARENA.size]} />
        <meshStandardMaterial {...floor} roughness={1} />
      </mesh>

      {walls.map((b, i) => (
        <mesh
          key={`wall-${i}`}
          position={b.p}
          material={wallMaterials[i]}
          castShadow
          receiveShadow
          userData={{ pickColor: WALL_COLOR }}
          onClick={pick(WALL_COLOR)}
        >
          <boxGeometry args={b.s} />
        </mesh>
      ))}

      {props.map((b: MapBox, i) => (
        <mesh key={`prop-${i}`} position={b.p} castShadow receiveShadow onClick={pick(b.c)}>
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
