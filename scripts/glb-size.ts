/**
 * Native bounding box of a .glb, read straight out of the container.
 *
 * src/game/models.ts records these numbers and derives every prop's collider
 * from them, so a stale entry there means the thing you can see and the thing
 * that blocks you have different sizes. Re-run this after changing a model.
 *
 * Run: npm run glb:size -- public/models/survival/barrel.glb [...]
 *
 * The .glb is parsed by hand rather than with GLTFLoader, which needs a DOM.
 * Only the JSON chunk is read: accessor min/max already bound each primitive,
 * so the node transforms are all that has to be applied.
 */

import { readFileSync } from "node:fs";
import * as THREE from "three";

function glbJson(path: string): any {
  const buf = readFileSync(path);
  // 12-byte header, then length-prefixed chunks; the first chunk is the JSON.
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"));
}

function nodeMatrix(n: any): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (n.matrix) return m.fromArray(n.matrix);
  return m.compose(
    new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1])
  );
}

function bounds(path: string): { size: THREE.Vector3; centre: THREE.Vector3 } {
  const g = glbJson(path);
  const box = new THREE.Box3();

  const visit = (index: number, parent: THREE.Matrix4) => {
    const n = g.nodes[index];
    const world = new THREE.Matrix4().multiplyMatrices(parent, nodeMatrix(n));

    if (n.mesh !== undefined) {
      for (const prim of g.meshes[n.mesh].primitives) {
        const accessor = g.accessors[prim.attributes.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        // Transform all eight corners: a rotated node's AABB is not its
        // untransformed min/max run through the matrix.
        for (let corner = 0; corner < 8; corner++) {
          box.expandByPoint(
            new THREE.Vector3(
              corner & 1 ? accessor.max[0] : accessor.min[0],
              corner & 2 ? accessor.max[1] : accessor.min[1],
              corner & 4 ? accessor.max[2] : accessor.min[2]
            ).applyMatrix4(world)
          );
        }
      }
    }

    for (const child of n.children ?? []) visit(child, world);
  };

  for (const root of g.scenes[g.scene ?? 0].nodes) visit(root, new THREE.Matrix4());

  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  return { size, centre };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npm run glb:size -- <file.glb> [...]");
  process.exit(1);
}

const round = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(3)).join(" x ");

for (const path of files) {
  const b = bounds(path);
  console.log(path.replace(/.*[\\/]/, "").padEnd(26), "size", round(b.size), "  centre", round(b.centre));
}
