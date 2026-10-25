import { type Material, type Mesh, type Object3D, type Texture } from "three";

/**
 * Frees the GPU memory behind a loaded model: every geometry, material and
 * texture once, even when shared. three.js never does this on its own; dropping
 * the scene from React state only removes it from the graph, so a 60 MB scan or
 * a 10 MB atlas would otherwise stay on the GPU after a switch.
 */
const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

const isTexture = (value: unknown): value is Texture =>
  typeof value === "object" && value !== null && (value as Texture).isTexture === true;

export const disposeObject3D = (root: Object3D): void => {
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (!isMesh(object)) return;
    object.geometry.dispose();
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) materials.add(material);
  });
  const textures = new Set<Texture>();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (isTexture(value)) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
};
