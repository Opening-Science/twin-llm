import {
  BufferAttribute,
  DynamicDrawUsage,
  Matrix3,
  Matrix4,
  type Mesh,
  type Object3D,
  Vector3,
} from "three";
import { heartVertexMask } from "../anatomy/heart-geometry";

/** Illustrative amplitudes: 4% heart contraction and 0.02 mm vessel expansion. */
export const VASCULAR_HEART_CONTRACTION = 0.04;
export const VESSEL_EXPANSION_M = 0.00002;

type VascularRig = Readonly<{
  original: Mesh["geometry"]["attributes"]["position"];
  box: Mesh["geometry"]["boundingBox"];
  sphere: Mesh["geometry"]["boundingSphere"];
  animated: BufferAttribute;
  rest: Float32Array;
  offsets: Float32Array;
  heart: Uint8Array;
}>;

const rigs = new WeakMap<Mesh, VascularRig | null>();

const unavailable = (mesh: Mesh, reason: string): null => {
  console.warn(`[anatomy] Vessel animation unavailable for ${mesh.name}: ${reason}`);
  rigs.set(mesh, null);
  return null;
};

const rigOf = (mesh: Mesh, root: Object3D): VascularRig | null => {
  const known = rigs.get(mesh);
  if (known !== undefined) return known;
  const heart = heartVertexMask(mesh);
  if (!heart) {
    rigs.set(mesh, null);
    return null;
  }
  const original = mesh.geometry.getAttribute("position");
  const normal = mesh.geometry.getAttribute("normal");
  if (!normal || !original || normal.count !== original.count) {
    return unavailable(mesh, "missing anatomy IDs, structure metadata or normals");
  }

  const rest = new Float32Array(original.count * 3);
  const offsets = new Float32Array(rest.length);
  const centre = new Vector3();
  const point = new Vector3();
  let heartCount = 0;
  for (let i = 0; i < original.count; i += 1) {
    point.set(original.getX(i), original.getY(i), original.getZ(i));
    point.toArray(rest, i * 3);
    if (heart[i]) {
      heartCount += 1;
      centre.add(point);
    }
  }
  if (heartCount === 0) return unavailable(mesh, "no tagged heart structures");
  centre.divideScalar(heartCount);

  root.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const toAtlas = new Matrix4()
    .copy(root.matrixWorld)
    .invert()
    .multiply(mesh.matrixWorld);
  const normalToAtlas = new Matrix3().getNormalMatrix(toAtlas);
  const vectorToLocal = new Matrix3().setFromMatrix4(toAtlas.clone().invert());
  const offset = new Vector3();
  let maxOffset = 0;
  for (let i = 0; i < original.count; i += 1) {
    if (heart[i]) {
      offset
        .copy(centre)
        .sub(point.fromArray(rest, i * 3))
        .multiplyScalar(VASCULAR_HEART_CONTRACTION);
    } else {
      // Move only across the surface, never towards a whole-body/system centre.
      offset
        .set(normal.getX(i), normal.getY(i), normal.getZ(i))
        .applyMatrix3(normalToAtlas)
        .normalize()
        .multiplyScalar(VESSEL_EXPANSION_M)
        .applyMatrix3(vectorToLocal);
    }
    offset.toArray(offsets, i * 3);
    maxOffset = Math.max(maxOffset, offset.length());
  }
  const box = mesh.geometry.boundingBox;
  const sphere = mesh.geometry.boundingSphere;
  if (!box) mesh.geometry.computeBoundingBox();
  if (!sphere) mesh.geometry.computeBoundingSphere();
  const expandedSphere = mesh.geometry.boundingSphere!.clone();
  expandedSphere.radius += maxOffset;
  Object.assign(mesh.geometry, {
    boundingBox: mesh.geometry.boundingBox!.clone().expandByScalar(maxOffset),
    boundingSphere: expandedSphere,
  });
  const animated = new BufferAttribute(new Float32Array(rest), 3).setUsage(
    DynamicDrawUsage,
  );
  const rig = { original, box, sphere, animated, rest, offsets, heart };
  rigs.set(mesh, rig);
  return rig;
};

/** Returns false when tagging is unavailable; the viewer then explains its glow-only fallback. */
export const setVascularPulse = (
  mesh: Mesh,
  root: Object3D,
  pulse: Readonly<{ heart: number; vessels: number }> | null,
): boolean => {
  if (pulse === null) {
    const rig = rigs.get(mesh);
    if (rig) {
      mesh.geometry.setAttribute("position", rig.original);
      Object.assign(mesh.geometry, { boundingBox: rig.box, boundingSphere: rig.sphere });
    }
    rigs.delete(mesh);
    return true;
  }
  const rig = rigOf(mesh, root);
  if (!rig) return false;
  const out = rig.animated.array;
  for (let vertex = 0; vertex < rig.heart.length; vertex += 1) {
    const amount = rig.heart[vertex] ? pulse.heart : pulse.vessels;
    const i = vertex * 3;
    out[i] = rig.rest[i]! + rig.offsets[i]! * amount;
    out[i + 1] = rig.rest[i + 1]! + rig.offsets[i + 1]! * amount;
    out[i + 2] = rig.rest[i + 2]! + rig.offsets[i + 2]! * amount;
  }
  rig.animated.needsUpdate = true;
  if (mesh.geometry.getAttribute("position") !== rig.animated) {
    mesh.geometry.setAttribute("position", rig.animated);
  }
  return true;
};
