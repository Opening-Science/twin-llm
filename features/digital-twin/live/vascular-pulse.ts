import { BufferAttribute, DynamicDrawUsage, type Mesh, Vector3 } from "three";
import { heartVertexMask } from "../anatomy/heart-geometry";

/** Illustrative amplitude: 4% heart contraction. */
export const VASCULAR_HEART_CONTRACTION = 0.04;

type VascularRig = Readonly<{
  original: Mesh["geometry"]["attributes"]["position"];
  box: Mesh["geometry"]["boundingBox"];
  sphere: Mesh["geometry"]["boundingSphere"];
  animated: BufferAttribute;
  rest: Float32Array;
  offsets: Float32Array;
  ranges: readonly { start: number; count: number }[];
}>;

const rigs = new WeakMap<Mesh, VascularRig | null>();

const unavailable = (mesh: Mesh, reason: string): null => {
  console.warn(`[anatomy] Heart animation unavailable for ${mesh.name}: ${reason}`);
  rigs.set(mesh, null);
  return null;
};

const rigOf = (mesh: Mesh): VascularRig | null => {
  const known = rigs.get(mesh);
  if (known !== undefined) return known;
  const heart = heartVertexMask(mesh);
  if (!heart) {
    rigs.set(mesh, null);
    return null;
  }
  const original = mesh.geometry.getAttribute("position");
  if (!original) return unavailable(mesh, "missing positions");

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

  const ranges: { start: number; count: number }[] = [];
  const offset = new Vector3();
  let maxOffset = 0;
  for (let i = 0; i < original.count; i += 1) {
    if (!heart[i]) continue;
    const start = i * 3;
    const last = ranges.at(-1);
    if (last && last.start + last.count === start) last.count += 3;
    else ranges.push({ start, count: 3 });
    offset
      .copy(centre)
      .sub(point.fromArray(rest, start))
      .multiplyScalar(VASCULAR_HEART_CONTRACTION)
      .toArray(offsets, start);
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
  const rig = { original, box, sphere, animated, rest, offsets, ranges };
  rigs.set(mesh, rig);
  return rig;
};

/** Returns false when tagging is unavailable; the viewer then explains its glow-only fallback. */
export const setVascularPulse = (mesh: Mesh, pulse: number | null): boolean => {
  if (pulse === null) {
    const rig = rigs.get(mesh);
    if (rig) {
      mesh.geometry.setAttribute("position", rig.original);
      Object.assign(mesh.geometry, { boundingBox: rig.box, boundingSphere: rig.sphere });
    }
    rigs.delete(mesh);
    return true;
  }
  const rig = rigOf(mesh);
  if (!rig) return false;
  const out = rig.animated.array;
  rig.animated.clearUpdateRanges();
  for (const { start, count } of rig.ranges) {
    for (let i = start; i < start + count; i += 1) {
      out[i] = rig.rest[i]! + rig.offsets[i]! * pulse;
    }
    rig.animated.addUpdateRange(start, count);
  }
  rig.animated.needsUpdate = true;
  if (mesh.geometry.getAttribute("position") !== rig.animated) {
    mesh.geometry.setAttribute("position", rig.animated);
  }
  return true;
};
