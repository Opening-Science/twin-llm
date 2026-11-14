import { type Bone, type Object3D, type SkinnedMesh, Vector3 } from "three";

import {
  buildSegments,
  measureSkin,
  SEGMENT_IDS,
  SIDES,
  type Joints,
  type PerSide,
  type SegmentId,
  type Segments,
} from "@/packages/anatomy/segments";

import { type JointId } from "../motion/gait";
import { type RigBinding } from "../motion/rig-map";

/**
 * Reads a loaded body for the segment fit: its joints from its skeleton, its
 * outline from its skin, and the bone each segment follows. The body is read
 * in the pose it stands in, so the fit holds whatever stance or clip frame
 * that is. Each skin vertex belongs to the segment whose bone moves it most,
 * which stays right where an arm rests against the trunk.
 *
 * Null when the body has no head or hand bones, no skinned mesh, or a part
 * with too little skin to measure; the caller then keeps the one-scale fit.
 */
export type BodyReading = Readonly<{
  segments: Segments;
  /** Per segment, in `SEGMENT_IDS` order: the bone it follows. */
  drive: readonly Object3D[];
}>;

/** About this many skin vertices are read: plenty for an outline. */
const SKIN_POINTS = 30_000;

const isSkinned = (object: Object3D): object is SkinnedMesh =>
  (object as SkinnedMesh).isSkinnedMesh === true;

/** Skinned meshes that draw: hidden helper nodes and their children are skipped. */
const skinnedMeshes = (root: Object3D): SkinnedMesh[] => {
  if (!root.visible) return [];
  return [
    ...(isSkinned(root) ? [root] : []),
    ...root.children.flatMap((child) => skinnedMeshes(child)),
  ];
};

export const readBody = (root: Object3D, binding: RigBinding): BodyReading | null => {
  const bone = (id: JointId): Bone | null => binding.joints.get(id)?.bone ?? null;
  const head = bone("head");
  if (!head || !binding.hands.L || !binding.hands.R) return null;
  const hands = binding.hands as PerSide<Bone>;
  const sided = <T>(pick: (side: "L" | "R") => T): PerSide<T> =>
    Object.fromEntries(SIDES.map((side) => [side, pick(side)])) as PerSide<T>;
  const bones: Readonly<Record<SegmentId, Bone>> = {
    pelvis: bone("pelvis") as Bone,
    abdomen: bone("spineLower") as Bone,
    chest: (bone("spineUpper") ?? bone("spineLower")) as Bone,
    neck: (bone("spineUpper") ?? bone("spineLower")) as Bone,
    head,
    ...(Object.fromEntries(
      SIDES.flatMap((side) => [
        [`thigh${side}`, bone(`upperLeg${side}`)],
        [`shin${side}`, bone(`lowerLeg${side}`)],
        [`foot${side}`, bone(`foot${side}`)],
        [`upperArm${side}`, bone(`upperArm${side}`)],
        [`forearm${side}`, bone(`lowerArm${side}`)],
        [`hand${side}`, hands[side]],
      ]),
    ) as Record<
      Exclude<SegmentId, "pelvis" | "abdomen" | "chest" | "neck" | "head">,
      Bone
    >),
  };
  const drive = SEGMENT_IDS.map((id) => bones[id]);

  root.updateWorldMatrix(true, true);
  const at = (joint: Object3D): Vector3 => joint.getWorldPosition(new Vector3());
  const joints: Joints = {
    hip: sided((side) => at(bones[`thigh${side}`])),
    knee: sided((side) => at(bones[`shin${side}`])),
    ankle: sided((side) => at(bones[`foot${side}`])),
    shoulder: sided((side) => at(bones[`upperArm${side}`])),
    elbow: sided((side) => at(bones[`forearm${side}`])),
    wrist: sided((side) => at(hands[side])),
    neck: at(head),
  };

  const segmentOf = new Map<Object3D, number>(drive.map((joint, i) => [joint, i]));
  /** The segment of the nearest bone up the chain that a segment follows. */
  const segmentAbove = (joint: Object3D | null): number =>
    joint === null ? -1 : (segmentOf.get(joint) ?? segmentAbove(joint.parent));
  const points: number[] = [];
  const labels: number[] = [];
  const point = new Vector3();
  for (const mesh of skinnedMeshes(root)) {
    mesh.skeleton.update();
    const owner = mesh.skeleton.bones.map(segmentAbove);
    const index = mesh.geometry.getAttribute("skinIndex");
    const weight = mesh.geometry.getAttribute("skinWeight");
    const step = Math.max(1, Math.ceil(index.count / SKIN_POINTS));
    for (let i = 0; i < index.count; i += step) {
      const strongest = [0, 1, 2, 3].reduce((best, slot) =>
        weight.getComponent(i, slot) > weight.getComponent(i, best) ? slot : best,
      );
      const label = owner[index.getComponent(i, strongest)] ?? -1;
      if (label < 0) continue;
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      points.push(point.x, point.y, point.z);
      labels.push(label);
    }
  }
  const skin = measureSkin(Float32Array.from(points), Uint8Array.from(labels), joints);
  return skin && { segments: buildSegments(joints, skin), drive };
};
