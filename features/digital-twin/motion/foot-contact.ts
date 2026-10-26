import { type Bone, type Object3D, Quaternion, Vector3 } from "three";

import { type BodyPose } from "./gait";
import { type RigBinding } from "./rig-map";

/**
 * Keeps a planted foot on the floor where it landed.
 *
 * A clip traced from a video plays in place, and its legs are rotations, so a
 * foot that stood still in the video can hang above the floor or slide. When
 * the pose says a foot is planted (`footContact`, from the clip's contact
 * flags), this runs after `applyPose` and bends that leg with two-bone IK
 * (thigh and shin) so the ankle reaches a target:
 *
 * - across the floor, where the ankle was when this footfall began (the pose
 *   names it by its onset; kept in the armature's own space, so turning the
 *   model does not move it);
 * - up and down, so the foot's lowest point (ankle or toe) is on the floor,
 *   at the height `applyPose` keeps the lowest foot.
 *
 * `applyPose` has already lowered the pelvis until the lowest foot touches
 * the floor, so a planted foot is only ever pulled down to the floor, never
 * through it. A planted foot is first laid flat (its heel-to-toe line back at
 * the slope it has at rest; the turn about the leg is the clip's), since the
 * landmarks' heel and toe are too noisy to tell a flat foot from a pointed
 * one; then the IK keeps that orientation. The IK is
 * weighted by the contact weight, which ramps over 0.1 s, so contacts blend
 * in and out. A target out of reach straightens the leg toward it.
 *
 * The planter keeps the anchors between frames; `reset` forgets them (a new
 * clip or body). Bones are three.js objects, set in place.
 */

type Side = "L" | "R";
const SIDES: readonly Side[] = ["L", "R"];

const worldOf = (object: Object3D): Vector3 => object.getWorldPosition(new Vector3());

/** Turns `bone` by the world-space rotation `turn` about its own origin. */
const turnInWorld = (bone: Bone, turn: Quaternion): void => {
  const world = bone.getWorldQuaternion(new Quaternion());
  const parent = bone.parent
    ? bone.parent.getWorldQuaternion(new Quaternion())
    : new Quaternion();
  bone.quaternion.copy(parent.invert().multiply(turn.clone().multiply(world)));
  bone.updateWorldMatrix(false, true);
};

/** Sets `bone`'s world rotation, keeping its parent. */
const setWorldRotation = (bone: Bone, world: Quaternion): void => {
  const parent = bone.parent
    ? bone.parent.getWorldQuaternion(new Quaternion())
    : new Quaternion();
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateWorldMatrix(false, true);
};

const IDENTITY = new Quaternion();

export type LegChain = Readonly<{
  thigh: Bone;
  shin: Bone;
  foot: Bone;
  /** The knee's hinge axis in world space when the leg is straight (bends the shin back). */
  hinge: Vector3;
}>;

/**
 * Two-bone IK: turns the shin about the knee, then the thigh about the hip,
 * so the ankle moves toward `target`, each turn scaled by `weight` (0 to 1).
 * The foot keeps its world rotation.
 */
export const reachWithLeg = (leg: LegChain, target: Vector3, weight: number): void => {
  if (weight <= 0) return;
  const footRotation = leg.foot.getWorldQuaternion(new Quaternion());
  const hip = worldOf(leg.thigh);
  const knee = worldOf(leg.shin);
  const ankle = worldOf(leg.foot);
  const upper = knee.distanceTo(hip);
  const lower = ankle.distanceTo(knee);
  const reach = Math.min(
    Math.max(target.distanceTo(hip), Math.abs(upper - lower) + 1e-4),
    upper + lower - 1e-4,
  );
  const toHip = hip.clone().sub(knee);
  const toAnkle = ankle.clone().sub(knee);
  const current = toHip.angleTo(toAnkle);
  const cosine = (upper * upper + lower * lower - reach * reach) / (2 * upper * lower);
  const wanted = Math.acos(Math.min(1, Math.max(-1, cosine)));
  // Turning the shin about toAnkle × toHip closes the knee; a straight leg
  // has no plane, so it bends about the hinge, backward.
  const plane = new Vector3().crossVectors(toAnkle, toHip);
  const axis = plane.length() > 1e-6 * upper * lower ? plane.normalize() : leg.hinge;
  const bend = new Quaternion().setFromAxisAngle(axis, current - wanted);
  turnInWorld(leg.shin, IDENTITY.clone().slerp(bend, weight));

  const moved = worldOf(leg.foot).sub(hip).normalize();
  const aim = target.clone().sub(hip).normalize();
  const swing = new Quaternion().setFromUnitVectors(moved, aim);
  turnInWorld(leg.thigh, IDENTITY.clone().slerp(swing, weight));
  setWorldRotation(leg.foot, footRotation);
};

const legOf = (binding: RigBinding, side: Side): LegChain | null => {
  const thigh = binding.joints.get(side === "L" ? "upperLegL" : "upperLegR");
  const shin = binding.joints.get(side === "L" ? "lowerLegL" : "lowerLegR");
  const foot = binding.joints.get(side === "L" ? "footL" : "footR");
  if (!thigh || !shin || !foot) return null;
  // The rest hinge is the body's left axis; it turns with the thigh.
  const turned = thigh.bone
    .getWorldQuaternion(new Quaternion())
    .multiply(thigh.restWorld.clone().invert());
  return {
    thigh: thigh.bone,
    shin: shin.bone,
    foot: foot.bone,
    hinge: binding.left.clone().applyQuaternion(turned).normalize(),
  };
};

export type FootPlanter = Readonly<{
  /** Holds the planted feet of `pose` on the floor; call right after `applyPose`. */
  plant: (binding: RigBinding, pose: BodyPose) => void;
  /** Forgets where the feet landed. */
  reset: () => void;
}>;

/**
 * Pitches the foot about its ankle so its heel-to-toe line (ankle to toe bone)
 * has the slope it has at rest, by `weight` of the way. Needs a toe bone.
 */
export const layFlat = (
  binding: RigBinding,
  side: Side,
  foot: Bone,
  weight: number,
): void => {
  const toe = binding.soles[side][1];
  const restSlope = binding.soleSlope[side];
  if (!toe || restSlope === null || weight <= 0) return;
  const along = worldOf(toe).sub(worldOf(foot));
  const length = along.length();
  if (length < 1e-6) return;
  const slope = Math.asin(Math.min(1, Math.max(-1, along.dot(binding.up) / length)));
  const axis = new Vector3().crossVectors(along, binding.up);
  if (axis.length() < 1e-6) return;
  // Turning `along` about along × up by a positive angle raises it.
  turnInWorld(
    foot,
    new Quaternion().setFromAxisAngle(axis.normalize(), (restSlope - slope) * weight),
  );
};

export const createFootPlanter = (): FootPlanter => {
  // Where each planted ankle landed, in the armature's space, and which footfall.
  const anchors = new Map<Side, Readonly<{ at: Vector3; onset: number }>>();
  const plant = (binding: RigBinding, pose: BodyPose): void => {
    const space = binding.pelvis.bone.parent;
    for (const side of SIDES) {
      const contact = pose.footContact;
      const weight = contact ? (side === "L" ? contact.footL : contact.footR) : 0;
      const onset = contact ? (side === "L" ? contact.onsetL : contact.onsetR) : -1;
      if (weight <= 0) {
        anchors.delete(side);
        continue;
      }
      const leg = legOf(binding, side);
      if (!leg) continue;
      layFlat(binding, side, leg.foot, Math.min(1, weight));
      const ankle = worldOf(leg.foot);
      const known = anchors.get(side);
      const anchor =
        known && known.onset === onset
          ? known
          : { at: space ? space.worldToLocal(ankle.clone()) : ankle.clone(), onset };
      anchors.set(side, anchor);
      const landed = space ? space.localToWorld(anchor.at.clone()) : anchor.at.clone();
      // Lift or lower the target so the foot's lowest point is on the floor.
      const lowest = Math.min(
        ...binding.soles[side].map((bone) => worldOf(bone).dot(binding.up)),
      );
      const height = ankle.dot(binding.up) - (lowest - binding.restFloor);
      const target = landed.addScaledVector(binding.up, height - landed.dot(binding.up));
      reachWithLeg(leg, target, Math.min(1, weight));
    }
  };
  return { plant, reset: () => anchors.clear() };
};
