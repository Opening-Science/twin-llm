import { type Bone, Euler, Matrix4, type Object3D, Quaternion, Vector3 } from "three";

import { type BodyPose, JOINT_IDS, type JointId } from "./gait";

/**
 * Maps the body-frame clips in `gait.ts` onto a loaded skeleton by joint name.
 *
 * Two rigs are known: ANNY's own skeleton (the rigged demo bodies, names like
 * `upperleg01.L`) and the Mixamo-style names of the BodyLoop scans' 31-joint
 * skeleton (`LeftUpLeg`, maybe behind a prefix such as `mixamorig:`). three.js
 * strips `.` and `:` from node names, so names are compared lower-case with
 * everything but letters and digits removed. When a required joint is missing
 * or ambiguous there is no binding and nothing moves.
 *
 * The body frame is measured on the rig at rest: left from the right hip to
 * the left hip, up from the hips to the shoulders, forward their cross product.
 * A clip rotation R (body frame) becomes the bone rotation
 * rest · (W⁻¹ B) · R · (B⁻¹ W), with W the bone's rest world rotation and B the
 * body frame, so it works whatever axes each bone's local frame uses.
 */

export type RigKind = "anny" | "mixamo";

const REQUIRED: readonly JointId[] = [
  "pelvis",
  "spineLower",
  "upperArmL",
  "upperArmR",
  "lowerArmL",
  "lowerArmR",
  "upperLegL",
  "upperLegR",
  "lowerLegL",
  "lowerLegR",
  "footL",
  "footR",
];

/** Candidate names per joint, already normalised; the first that matches wins. */
export const RIG_NAMES: Readonly<
  Record<RigKind, Readonly<Record<JointId, readonly string[]>>>
> = {
  anny: {
    pelvis: ["root"],
    spineLower: ["spine05"],
    spineUpper: ["spine02"],
    clavicleL: ["claviclel"],
    clavicleR: ["clavicler"],
    upperArmL: ["upperarm01l"],
    upperArmR: ["upperarm01r"],
    lowerArmL: ["lowerarm01l"],
    lowerArmR: ["lowerarm01r"],
    upperLegL: ["upperleg01l"],
    upperLegR: ["upperleg01r"],
    lowerLegL: ["lowerleg01l"],
    lowerLegR: ["lowerleg01r"],
    footL: ["footl"],
    footR: ["footr"],
    head: ["head"],
  },
  mixamo: {
    pelvis: ["hips"],
    spineLower: ["spine"],
    spineUpper: ["spine2", "spine1"],
    clavicleL: ["leftshoulder"],
    clavicleR: ["rightshoulder"],
    upperArmL: ["leftarm"],
    upperArmR: ["rightarm"],
    lowerArmL: ["leftforearm"],
    lowerArmR: ["rightforearm"],
    upperLegL: ["leftupleg"],
    upperLegR: ["rightupleg"],
    lowerLegL: ["leftleg"],
    lowerLegR: ["rightleg"],
    footL: ["leftfoot"],
    footR: ["rightfoot"],
    head: ["head"],
  },
};

/** Toe bones, optional: they keep a pushed-off foot from sinking into the floor. */
const TOE_NAMES: Readonly<Record<RigKind, readonly string[]>> = {
  anny: ["toe31l", "toe31r"],
  mixamo: ["lefttoebase", "righttoebase"],
};

export const normaliseJointName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The index of the one name equal to `wanted`, else of the one ending in it; null if none or several. */
const findName = (names: readonly string[], wanted: string): number | null => {
  const exact = names.flatMap((name, i) => (name === wanted ? [i] : []));
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const suffix = names.flatMap((name, i) => (name.endsWith(wanted) ? [i] : []));
  return suffix.length === 1 ? (suffix[0] ?? null) : null;
};

export type ResolvedRig = Readonly<{
  kind: RigKind;
  /** Index into the given names for each joint found. */
  joints: Readonly<Partial<Record<JointId, number>>>;
}>;

/**
 * Which known rig a list of bone names is, and where each joint is in it, or
 * null when no rig has every required joint exactly once.
 */
export const resolveRig = (boneNames: readonly string[]): ResolvedRig | null => {
  const names = boneNames.map(normaliseJointName);
  for (const kind of ["anny", "mixamo"] as const) {
    const joints: Partial<Record<JointId, number>> = {};
    for (const id of JOINT_IDS) {
      for (const candidate of RIG_NAMES[kind][id]) {
        const index = findName(names, candidate);
        if (index !== null) {
          joints[id] = index;
          break;
        }
      }
    }
    if (REQUIRED.every((id) => joints[id] !== undefined)) return { kind, joints };
  }
  return null;
};

type BoundJoint = Readonly<{
  bone: Bone;
  rest: Quaternion;
  /** The bone's world rotation at rest. */
  restWorld: Quaternion;
  /** W⁻¹ · B, and its inverse: the body frame seen from the bone's rest frame. */
  toBone: Quaternion;
  fromBone: Quaternion;
}>;

export type RigBinding = Readonly<{
  kind: RigKind;
  joints: ReadonlyMap<JointId, BoundJoint>;
  pelvis: Readonly<{ bone: Bone; restPosition: Vector3; restWorld: Vector3 }>;
  /** Ankles, and toes when the rig has them: whichever is lowest touches the floor. */
  feet: readonly Bone[];
  /** The same per side: the ankle first, then the toe when there is one. */
  soles: Readonly<Record<"L" | "R", readonly Bone[]>>;
  /** Per side, the rest slope (radians, up positive) from the ankle to the toe; null without a toe. */
  soleSlope: Readonly<Record<"L" | "R", number | null>>;
  up: Vector3;
  left: Vector3;
  /** The lowest foot point's height along `up` at rest; walking keeps one foot there. */
  restFloor: number;
}>;

const isBone = (object: Object3D): object is Bone => (object as Bone).isBone === true;

const worldOf = (object: Object3D): Vector3 => object.getWorldPosition(new Vector3());

/**
 * Binds the clips to the skeleton under `root`, read in its current pose,
 * which must be the rest pose. Null when there is no known rig or its hips and
 * shoulders do not give a usable body frame.
 */
export const bindRig = (root: Object3D): RigBinding | null => {
  const bones: Bone[] = [];
  root.traverse((object) => {
    if (isBone(object)) bones.push(object);
  });
  const names = bones.map((bone) => normaliseJointName(bone.name));
  const resolved = resolveRig(bones.map((bone) => bone.name));
  if (!resolved) return null;
  const at = (id: JointId): Bone | null => {
    const index = resolved.joints[id];
    return index === undefined ? null : (bones[index] ?? null);
  };
  const need = (id: JointId): Bone => at(id) as Bone;

  root.updateWorldMatrix(true, true);
  const hipL = worldOf(need("upperLegL"));
  const hipR = worldOf(need("upperLegR"));
  const shoulders = worldOf(need("upperArmL"))
    .add(worldOf(need("upperArmR")))
    .multiplyScalar(0.5);
  const hips = hipL.clone().add(hipR).multiplyScalar(0.5);
  const left = hipL.clone().sub(hipR);
  const upRaw = shoulders.sub(hips);
  if (left.length() < 1e-6 || upRaw.length() < 1e-6) return null;
  left.normalize();
  const up = upRaw.sub(left.clone().multiplyScalar(upRaw.dot(left)));
  if (up.length() < 1e-6) return null;
  up.normalize();
  const forward = new Vector3().crossVectors(left, up);
  const body = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(left, up, forward),
  );

  const joints = new Map<JointId, BoundJoint>();
  for (const id of JOINT_IDS) {
    const bone = at(id);
    if (!bone) continue;
    const world = bone.getWorldQuaternion(new Quaternion());
    const toBone = world.clone().invert().multiply(body);
    joints.set(id, {
      bone,
      rest: bone.quaternion.clone(),
      restWorld: world,
      toBone,
      fromBone: toBone.clone().invert(),
    });
  }
  const pelvis = need("pelvis");
  const toeOf = (wanted: string | undefined): Bone[] => {
    const index = wanted === undefined ? null : findName(names, wanted);
    const toe = index === null ? undefined : bones[index];
    return toe ? [toe] : [];
  };
  const [toeL, toeR] = TOE_NAMES[resolved.kind];
  const soles = {
    L: [need("footL"), ...toeOf(toeL)],
    R: [need("footR"), ...toeOf(toeR)],
  };
  const feet = [need("footL"), need("footR"), ...soles.L.slice(1), ...soles.R.slice(1)];
  const slopeOf = (sole: readonly Bone[]): number | null => {
    const [ankle, toe] = sole;
    if (!ankle || !toe) return null;
    const along = worldOf(toe).sub(worldOf(ankle));
    return along.length() < 1e-6 ? null : Math.asin(along.dot(up) / along.length());
  };
  return {
    kind: resolved.kind,
    joints,
    pelvis: {
      bone: pelvis,
      restPosition: pelvis.position.clone(),
      restWorld: worldOf(pelvis),
    },
    feet,
    soles,
    soleSlope: { L: slopeOf(soles.L), R: slopeOf(soles.R) },
    up,
    left,
    restFloor: Math.min(...feet.map((foot) => worldOf(foot).dot(up))),
  };
};

const euler = new Euler();
const clipRotation = new Quaternion();
const target = new Vector3();

/**
 * Poses the skeleton. The pelvis then moves along `up` so the lowest ankle or
 * toe sits where it stood at rest: walking in place stays on the floor. With
 * both feet planted (`footContact`) it is the higher foot instead, and
 * `foot-contact.ts` then bends the other leg up to the floor. A pose's
 * `pelvisLift` raises the body off it (a run's flight phase).
 * Bones are three.js objects, configured in place every frame.
 */
export const applyPose = (binding: RigBinding, pose: BodyPose): void => {
  for (const [id, joint] of binding.joints) {
    const { pitch, roll, yaw } = pose.joints[id];
    // Ry(yaw) · Rz(roll) · Rx(-pitch) in the body frame (x left, y up, z forward).
    clipRotation.setFromEuler(euler.set(-pitch, yaw, roll, "YZX"));
    joint.bone.quaternion
      .copy(joint.rest)
      .multiply(joint.toBone)
      .multiply(clipRotation)
      .multiply(joint.fromBone);
  }
  const { bone, restPosition, restWorld } = binding.pelvis;
  bone.position.copy(restPosition);
  bone.updateWorldMatrix(true, true);
  const lowest = (bones: readonly Bone[]) =>
    Math.min(...bones.map((foot) => worldOf(foot).dot(binding.up)));
  const lowestL = lowest(binding.soles.L);
  const lowestR = lowest(binding.soles.R);
  const base = Math.min(lowestL, lowestR);
  // With both feet planted, the higher one goes to the floor: the hips come
  // down as far as the clip's bent knees put them, and the planter bends the
  // other leg to keep its foot on the floor rather than straightening it.
  const bothPlanted = pose.footContact
    ? Math.min(pose.footContact.footL, pose.footContact.footR)
    : 0;
  const floor = base + (Math.max(lowestL, lowestR) - base) * Math.min(1, bothPlanted);
  target
    .copy(restWorld)
    .addScaledVector(binding.left, pose.pelvisShift)
    .addScaledVector(binding.up, binding.restFloor - floor + (pose.pelvisLift ?? 0));
  bone.position.copy(bone.parent ? bone.parent.worldToLocal(target.clone()) : target);
  bone.updateWorldMatrix(false, true);
};

/** Puts every bound bone back exactly as it was bound. */
export const restorePose = (binding: RigBinding): void => {
  for (const joint of binding.joints.values()) joint.bone.quaternion.copy(joint.rest);
  binding.pelvis.bone.position.copy(binding.pelvis.restPosition);
  binding.pelvis.bone.updateWorldMatrix(false, true);
};
