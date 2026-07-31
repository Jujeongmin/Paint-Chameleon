import { useMemo } from "react";
import { ThreeEvent, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ARENA, FLOOR_COLOR, MAP_BOXES, WALL_COLOR } from "./map";
import { instancingPlan, modelDrawn } from "./instancing";
import { meshParts, placeModel, useProps, type ModelId } from "./props";

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

  const models = useProps();

  // The perimeter stays boxes: a 46u run would stretch a model past
  // recognition, and the corrugated steel texture reads fine at that size.
  const perimeter = useMemo(() => MAP_BOXES.filter((b) => b.wall && b.s[1] === ARENA.wallHeight), []);

  // Platform decks: structure you stand on, drawn as the textured box that IS
  // the collider — no model in the kit is deck-shaped.
  const slabs = useMemo(() => MAP_BOXES.filter((b) => b.slab), []);

  // Everything model-drawn splits by repetition (instancing.ts): repeated
  // models become one InstancedMesh per (geometry, material) part, one-offs
  // keep the cloned-scene path. Rebuilding these once matters either way.
  const plan = useMemo(() => instancingPlan(modelDrawn(MAP_BOXES, ARENA.wallHeight)), []);

  const fitted = useMemo(
    () =>
      plan.singles.map((b) => {
        const id = (b.family ?? "partition") as ModelId;
        return { box: b, object: placeModel(id, b.c, models[id]) };
      }),
    [plan, models]
  );

  const instanced = useMemo(() => {
    const scratch = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const meshes: { mesh: THREE.InstancedMesh; colors: number[] }[] = [];

    for (const [id, boxes] of plan.instanced) {
      for (const part of meshParts(id as ModelId, models[id as ModelId])) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, boxes.length);
        boxes.forEach((b, i) => {
          // Box transform first, then the part's own place inside the model.
          scratch.makeTranslation(b.p[0], b.p[1], b.p[2]);
          if (b.rotY) scratch.multiply(rotation.makeRotationY(b.rotY));
          scratch.multiply(part.matrix);
          mesh.setMatrixAt(i, scratch);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        meshes.push({ mesh, colors: boxes.map((b) => b.c) });
      }
    }
    return meshes;
  }, [plan, models]);

  // One material per wall: a box's faces are metres apart in size, so a shared
  // repeat would stretch the texture differently on each of them.
  const wallMaterials = useMemo(
    () =>
      perimeter.map((b) => {
        const across = Math.max(b.s[0], b.s[2]);
        return new THREE.MeshStandardMaterial({
          ...tiled(wallSource, across / TILE, b.s[1] / TILE, anisotropy),
          roughness: 1,
          metalness: 0.05,
        });
      }),
    [perimeter, wallSource, anisotropy]
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

      {perimeter.map((b, i) => (
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

      {slabs.map((b, i) => (
        <mesh
          key={`slab-${i}`}
          position={b.p}
          castShadow
          receiveShadow
          userData={{ pickColor: WALL_COLOR }}
          onClick={pick(WALL_COLOR)}
        >
          <boxGeometry args={b.s} />
          <meshStandardMaterial
            {...tiled(wallSource, Math.max(b.s[0], b.s[2]) / TILE, Math.max(b.s[0], b.s[2]) / TILE, anisotropy)}
            roughness={1}
          />
        </mesh>
      ))}

      {fitted.map(({ box, object }, i) => (
        <primitive
          key={`prop-${i}`}
          object={object}
          position={box.p}
          rotation-y={box.rotY ?? 0}
          onClick={pick(box.c)}
        />
      ))}

      {instanced.map(({ mesh, colors }, i) => (
        <primitive
          key={`inst-${i}`}
          object={mesh}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            // Instances share one mesh, so the colour has to come from which
            // instance the ray hit rather than from the object.
            if (!onPickColor || e.instanceId === undefined) return;
            e.stopPropagation();
            onPickColor(colors[e.instanceId] ?? WALL_COLOR);
          }}
        />
      ))}
    </group>
  );
}

export function Lighting() {
  return (
    <>
      <hemisphereLight args={["#b9c6d6", "#2a2f38", 0.85]} />
      {/* The shadow camera has to cover the whole floor or shadows stop dead
          in a straight line partway across it. 2048 over 96u is about 21
          texels per unit, which is soft but not obviously wrong. */}
      <directionalLight
        position={[36, 52, 24]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-48}
        shadow-camera-right={48}
        shadow-camera-top={48}
        shadow-camera-bottom={-48}
        shadow-camera-far={140}
      />
      <ambientLight intensity={0.25} />
      {/* Pulled back with the arena: at 88x88 the old 62u far plane hid the
          far half of the map behind a flat wall of fog. */}
      <fog attach="fog" args={["#1a1f28", 55, 135]} />
      <color attach="background" args={["#1a1f28"]} />
    </>
  );
}
