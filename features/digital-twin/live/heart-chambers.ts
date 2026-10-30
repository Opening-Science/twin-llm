import {
  BufferAttribute,
  DynamicDrawUsage,
  Matrix4,
  type Mesh,
  type Object3D,
  Vector3,
} from "three";

import { type ChamberContraction } from "./heart-cycle";
import {
  atrialWeights,
  createHeartDeformer,
  type HeartDeformer,
  regionCentres,
} from "./heart-deform";

/**
 * Puts the two-phase heart deformation on the atlas heart mesh (#53). While it
 * beats, the geometry draws from a float copy of its positions that the
 * deformer rewrites each frame; stopping puts the atlas's own (quantised)
 * attribute back, so nothing of the atlas changes for good.
 */
type ChamberRig = Readonly<{
  original: Mesh["geometry"]["attributes"]["position"];
  animated: BufferAttribute;
  deformer: HeartDeformer;
}>;

const rigs = new WeakMap<Mesh, ChamberRig>();

const rigOf = (mesh: Mesh, root: Object3D): ChamberRig => {
  const known = rigs.get(mesh);
  if (known) return known;
  const original = mesh.geometry.getAttribute("position");
  const count = original.count;
  const rest = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    rest[index * 3] = original.getX(index);
    rest[index * 3 + 1] = original.getY(index);
    rest[index * 3 + 2] = original.getZ(index);
  }
  // The atlas frame (+Y up, +Z front, +X left) is the atlas root's, not the world's:
  // the fit rotates and scales the root onto the scan.
  root.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const toAtlas = new Matrix4()
    .copy(root.matrixWorld)
    .invert()
    .multiply(mesh.matrixWorld);
  const point = new Vector3();
  const inAtlas = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    point
      .fromArray(rest, index * 3)
      .applyMatrix4(toAtlas)
      .toArray(inAtlas, index * 3);
  }
  const weights = atrialWeights(inAtlas);
  const deformer = createHeartDeformer(rest, weights, regionCentres(rest, weights));
  const animated = new BufferAttribute(deformer.positions, 3).setUsage(DynamicDrawUsage);
  const rig = { original, animated, deformer };
  rigs.set(mesh, rig);
  return rig;
};

/** Draws the heart at this contraction; null puts the atlas mesh back exactly. */
export const setHeartChambers = (
  mesh: Mesh,
  root: Object3D,
  contraction: ChamberContraction | null,
): void => {
  if (contraction === null) {
    const rig = rigs.get(mesh);
    if (!rig) return;
    rigs.delete(mesh);
    mesh.geometry.setAttribute("position", rig.original);
    return;
  }
  const rig = rigOf(mesh, root);
  rig.deformer.apply(contraction.atria, contraction.ventricles);
  rig.animated.needsUpdate = true;
  if (mesh.geometry.getAttribute("position") !== rig.animated) {
    mesh.geometry.setAttribute("position", rig.animated);
  }
};
