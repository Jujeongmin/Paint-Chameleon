import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

/**
 * Prop models.
 *
 * Every solid thing in the arena is still an axis-aligned MapBox — that box is
 * what collides, what the camera pulls in against, and what check:map reasons
 * about. These models are what you see in its place. A model is fitted to its
 * box rather than the other way round, so what blocks you is what you see.
 *
 * This replaced the flat two-tone boxes the mimicry design called for. Hiding
 * by passing for a prop needed props a player could match with flat paint, and
 * a textured model is not that. That trade was made deliberately (see the
 * arena redesign design doc); hiding now rests on cover and sightlines.
 *
 * Swapping a look is a one-line change to MODELS.
 *
 * Models are grouped by the kit they came from because each Kenney kit ships
 * its own Textures/colormap.png and its GLBs reference it by relative path.
 * Put two kits in one folder and the second one silently wears the first one's
 * palette.
 */

const MODELS = {
  drum: "/models/survival/barrel.glb",
  crate: "/models/survival/box-large.glb",
  pallet: "/models/survival/resource-planks.glb",
  pillar: "/models/factory/structure-tall.glb",
  partition: "/models/factory/structure-wall.glb",
} as const;

export type ModelId = keyof typeof MODELS;

const MODEL_URLS = Object.values(MODELS) as string[];
const MODEL_IDS = Object.keys(MODELS) as ModelId[];

type Loaded = Record<ModelId, THREE.Object3D>;

export function useProps(): Loaded {
  const gltfs = useLoader(GLTFLoader, MODEL_URLS);
  return useMemo(() => {
    const out = {} as Loaded;
    MODEL_IDS.forEach((id, i) => {
      out[id] = gltfs[i].scene;
    });
    return out;
  }, [gltfs]);
}

/**
 * A copy of `source` scaled to exactly fill `size` and centred on its own
 * origin, ready to drop at a MapBox's centre.
 *
 * The fit is non-uniform on purpose. A uniform fit would leave the model
 * rattling inside a collider it doesn't touch, and players read the gap as the
 * game being wrong about where things are.
 *
 * `pickColor` is stamped on every mesh because the eyedropper reads a material
 * colour, and these materials are a shared texture atlas — without it, picking
 * a prop returns whatever the atlas material happens to say.
 */
export function fitModel(
  source: THREE.Object3D,
  size: [number, number, number],
  pickColor: number
): THREE.Object3D {
  const model = source.clone(true);

  const box = new THREE.Box3().setFromObject(model);
  const extent = new THREE.Vector3();
  box.getSize(extent);
  const centre = new THREE.Vector3();
  box.getCenter(centre);

  // A degenerate axis (a flat plane) would divide by zero.
  const scale = new THREE.Vector3(
    extent.x > 1e-6 ? size[0] / extent.x : 1,
    extent.y > 1e-6 ? size[1] / extent.y : 1,
    extent.z > 1e-6 ? size[2] / extent.z : 1
  );

  const holder = new THREE.Group();
  model.position.set(-centre.x, -centre.y, -centre.z);
  holder.add(model);
  holder.scale.copy(scale);

  holder.traverse((o) => {
    o.userData.pickColor = pickColor;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  return holder;
}
