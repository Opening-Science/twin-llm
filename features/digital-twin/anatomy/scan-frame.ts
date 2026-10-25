import { Box3, type Bone, type Material, type Mesh, type Object3D, Vector3 } from "three";

import { type ScanFrame } from "@/packages/anatomy/fit";

/**
 * What the fit needs from a loaded BodyLoop scan: its box (SkinnedMesh-aware,
 * the same box the camera fit uses), its floor and height, the measured stature
 * when it is plausible, and the midpoint of
 * the two hip joints from its 31-joint skeleton when that is plausible.
 */
const findBone = (root: Object3D, suffix: string): Object3D | null => {
  let found: Object3D | null = null;
  const wanted = suffix.toLowerCase();
  root.traverse((object) => {
    if (!found && (object as Bone).isBone && object.name.toLowerCase().endsWith(wanted)) {
      found = object;
    }
  });
  return found;
};

/**
 * A measured stature is used only when it fits the scan's box: the box adds
 * hair, so stature can be a little lower, never clearly higher.
 */
const STATURE_BAND: readonly [number, number] = [0.85, 1.02];

export const plausibleStature = (
  stature: number | null,
  boxHeight: number,
): number | null =>
  stature !== null &&
  Number.isFinite(stature) &&
  boxHeight > 0 &&
  stature >= boxHeight * STATURE_BAND[0] &&
  stature <= boxHeight * STATURE_BAND[1]
    ? stature
    : null;

/** Hip joints sit at about 0.53 of body height; anything far off is a bad rig. */
const HIP_BAND: readonly [number, number] = [0.4, 0.65];

export const readScanFrame = (
  root: Object3D,
  measuredStature: number | null = null,
): ScanFrame => {
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root);
  const floorZ = box.min.z;
  const height = box.max.z - box.min.z;
  const stature = plausibleStature(measuredStature, height);
  const left = findBone(root, "LeftUpLeg");
  const right = findBone(root, "RightUpLeg");
  if (!left || !right || !(height > 0)) {
    return { box, floorZ, height, stature, hipMidpoint: null };
  }

  const mid = left
    .getWorldPosition(new Vector3())
    .add(right.getWorldPosition(new Vector3()))
    .multiplyScalar(0.5);
  const relative = (mid.z - floorZ) / height;
  const inside =
    mid.x >= box.min.x && mid.x <= box.max.x && mid.y >= box.min.y && mid.y <= box.max.y;
  const plausible = relative >= HIP_BAND[0] && relative <= HIP_BAND[1] && inside;
  return { box, floorZ, height, stature, hipMidpoint: plausible ? mid : null };
};

/** Every material on the scan's meshes, once, for the glass fade. */
export const collectScanMaterials = (root: Object3D): readonly Material[] => {
  const found = new Set<Material>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      found.add(material);
    }
  });
  return [...found];
};
