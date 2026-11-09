import { FrontSide, type Material, Mesh, MeshBasicMaterial, type Object3D } from "three";

import { type AtlasLayerId } from "@/packages/anatomy/layers";

import { type BlendMode } from "./layer-material";

/**
 * A glass atlas layer (fade or rim mode) draws twice: first its meshes to
 * depth only, then their colour blended at the real alpha with depth test
 * LessEqual. Each pixel then shows only that layer's front-most surface, so the
 * layer cannot blend with itself in the wrong order, and nothing is dithered.
 * In rim mode it also keeps the rims of hidden folds (HRA's pelvis) from
 * stacking into a lace pattern.
 *
 * Draw order, all in three's transparent queue, so after every opaque layer:
 * inner layers first, each one's pre-pass right before its colour, and the
 * scan's glass last, since it encloses everything.
 */
export const RENDER_ORDER: Readonly<
  Record<AtlasLayerId, Readonly<{ prepass: number; colour: number }>>
> = {
  organs: { prepass: 1, colour: 2 },
  skeleton: { prepass: 3, colour: 4 },
  muscle: { prepass: 5, colour: 6 },
};

export const SCAN_RENDER_ORDER = 7;

/** One depth-only material serves every pre-pass of an atlas. */
export const createDepthPrepassMaterial = (): MeshBasicMaterial =>
  new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    transparent: true,
    side: FrontSide,
  });

const prepasses = new WeakMap<Mesh, Mesh>();

const neverHit = (): void => undefined;

/**
 * Adds a depth-only twin of the mesh as its child (same geometry, so it moves,
 * scales and hides with the mesh). It never takes a pick. Hidden until the
 * mesh's layer is glass. Idempotent.
 */
export const attachDepthPrepass = (mesh: Mesh, material: Material): Mesh => {
  const existing = prepasses.get(mesh);
  if (existing) return existing;
  const prepass = new Mesh(mesh.geometry, material);
  // three.js objects are configured by mutation; the writes go through one
  // explicit Object.assign so they are easy to find.
  Object.assign(prepass, {
    name: `${mesh.name}#depth`,
    visible: false,
    raycast: neverHit,
  });
  mesh.add(prepass);
  prepasses.set(mesh, prepass);
  allPrepasses.add(prepass);
  return prepass;
};

const allPrepasses = new WeakSet<Object3D>();

/** Whether an object is some mesh's depth-only twin. */
export const isDepthPrepass = (object: Object3D): boolean => allPrepasses.has(object);

/** The pre-pass attached to a mesh, if any. */
export const depthPrepassOf = (mesh: Mesh): Mesh | null => prepasses.get(mesh) ?? null;

/** Sets a part's draw order and turns its pre-pass on only while its layer is glass. */
export const setLayerPasses = (
  mesh: Mesh,
  layer: AtlasLayerId,
  mode: BlendMode,
): void => {
  const order = RENDER_ORDER[layer];
  const prepass = prepasses.get(mesh);
  Object.assign(mesh, { renderOrder: order.colour });
  if (prepass) {
    Object.assign(prepass, {
      renderOrder: order.prepass,
      visible: mode === "fade" || mode === "rim",
    });
  }
};

/** Every mesh under a root (the scan) draws after the atlas layers. */
export const setScanRenderOrder = (root: Object3D, order: number): void => {
  root.traverse((object) => {
    if ((object as Mesh).isMesh) Object.assign(object, { renderOrder: order });
  });
};
