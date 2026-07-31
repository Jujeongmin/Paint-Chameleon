import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { MODELS, type ModelId } from "./models";

export type { ModelId };

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
 * Which model each family uses, and how big it is, live in models.ts — the
 * check scripts need those numbers and can't import anything that touches
 * three.js.
 *
 * Models are grouped on disk by the kit they came from because each Kenney kit
 * ships its own Textures/colormap.png and its GLBs reference it by relative
 * path. Put two kits in one folder and the second silently wears the first
 * one's palette.
 */

const MODEL_IDS = Object.keys(MODELS) as ModelId[];
const MODEL_URLS = MODEL_IDS.map((id) => MODELS[id].url);

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
 * A copy of the model at its kit's scale, centred on its own origin so it can
 * be dropped straight at a MapBox's centre.
 *
 * The scale is uniform and comes from models.ts, which is also where the
 * collider is derived from — so the model always fills its box vertically and
 * on its wider horizontal axis, and never stretches. An earlier version scaled
 * each axis independently to fill the box exactly; it fit, and every object
 * looked wrong.
 *
 * `pickColor` is stamped on every mesh because the eyedropper reads a material
 * colour, and these materials are one shared texture atlas — without it,
 * picking any prop returns whatever the atlas material happens to say.
 */
/**
 * The (geometry, material, local transform) parts of one model, at its kit
 * scale and centred like placeModel leaves it — the flattened form
 * InstancedMesh needs, since an instance is one geometry drawn many times and
 * a GLB scene is a tree.
 *
 * The world matrices are baked while the model sits in a temporary holder
 * whose transform matches what placeModel would apply, so an instanced prop
 * and a placed one land pixel-identically.
 */
export function meshParts(
  id: ModelId,
  source: THREE.Object3D
): { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] {
  const model = source.clone(true);
  const { scale } = MODELS[id];

  const box = new THREE.Box3().setFromObject(model);
  const centre = new THREE.Vector3();
  box.getCenter(centre);

  const holder = new THREE.Group();
  model.position.set(-centre.x, -centre.y, -centre.z);
  holder.add(model);
  holder.scale.setScalar(scale);
  holder.updateMatrixWorld(true);

  const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] = [];
  holder.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
    }
  });
  return parts;
}

export function placeModel(id: ModelId, pickColor: number, source: THREE.Object3D): THREE.Object3D {
  const model = source.clone(true);
  const { scale } = MODELS[id];

  const box = new THREE.Box3().setFromObject(model);
  const centre = new THREE.Vector3();
  box.getCenter(centre);

  const holder = new THREE.Group();
  model.position.set(-centre.x, -centre.y, -centre.z);
  holder.add(model);
  holder.scale.setScalar(scale);

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
