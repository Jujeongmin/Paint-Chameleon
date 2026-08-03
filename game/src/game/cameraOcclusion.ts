import { useLayoutEffect, type RefObject } from "react";
import * as THREE from "three";

const targetView = new THREE.Vector3();
const enabled = { value: 0 };
const targetUniform = { value: targetView };
const radiusUniform = { value: 0.72 };

export function setCameraOcclusion(camera: THREE.Camera, target: THREE.Vector3, active: boolean): void {
  enabled.value = active ? 1 : 0;
  if (!active) return;
  camera.updateMatrixWorld();
  targetView.copy(target).applyMatrix4(camera.matrixWorldInverse);
}

export function clearCameraOcclusion(): void {
  enabled.value = 0;
}

function patchMaterial(material: THREE.Material): () => void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.cameraOcclusionEnabled = enabled;
    shader.uniforms.cameraOcclusionTargetView = targetUniform;
    shader.uniforms.cameraOcclusionRadius = radiusUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float cameraOcclusionEnabled;
uniform vec3 cameraOcclusionTargetView;
uniform float cameraOcclusionRadius;`)
      .replace("#include <opaque_fragment>", `if (cameraOcclusionEnabled > 0.5) {
        vec3 occlusionPoint = -vViewPosition;
        float occlusionLengthSq = dot(cameraOcclusionTargetView, cameraOcclusionTargetView);
        float occlusionAlong = dot(occlusionPoint, cameraOcclusionTargetView) / max(occlusionLengthSq, 0.0001);
        vec3 occlusionNearest = cameraOcclusionTargetView * clamp(occlusionAlong, 0.0, 1.0);
        float occlusionDistance = length(occlusionPoint - occlusionNearest);
        float occlusionAmount = (1.0 - smoothstep(cameraOcclusionRadius, cameraOcclusionRadius + 0.35, occlusionDistance))
          * step(0.03, occlusionAlong) * step(occlusionAlong, 0.97);
        if (occlusionAmount > 0.01) {
          float occlusionDither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (occlusionDither < occlusionAmount * 0.78) discard;
        }
      }
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}:camera-occlusion-v1`;
  material.needsUpdate = true;
  return () => {
    material.onBeforeCompile = previous;
    material.customProgramCacheKey = previousKey;
    material.needsUpdate = true;
  };
}

export function useCameraOccluders(root: RefObject<THREE.Group>): void {
  useLayoutEffect(() => {
    const materials = new Set<THREE.Material>();
    root.current?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      let node: THREE.Object3D | null = object;
      while (node) {
        if (node.userData.cameraOccluder === false) return;
        node = node.parent;
      }
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) materials.add(material);
      });
    });
    const cleanups = [...materials].map(patchMaterial);
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [root]);
}
