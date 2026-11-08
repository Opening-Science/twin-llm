import { type DemoStance } from "@/packages/anatomy/stance";

import { type BodyPose, JOINT_IDS, type JointId, type JointRotation } from "./gait";

const DEG = Math.PI / 180;

/**
 * A demo body's stance (`DEMO_STANCE`) as a pose in the clips' body frame:
 * each hip turned inward (a negative roll on the left leg, positive on the
 * right) and each ankle turned back by the same angle, so the sole stays flat.
 */
export const stancePose = (stance: DemoStance): BodyPose => {
  const hip = stance.hipAdductionDeg * DEG;
  const rolls: Partial<Record<JointId, number>> = {
    upperLegL: -hip,
    upperLegR: hip,
    footL: hip,
    footR: -hip,
  };
  return {
    joints: Object.fromEntries(
      JOINT_IDS.map((id): [JointId, JointRotation] => [
        id,
        { pitch: 0, roll: rolls[id] ?? 0, yaw: 0 },
      ]),
    ) as Record<JointId, JointRotation>,
    pelvisShift: 0,
  };
};

/**
 * A clip's pose played on top of the stance: the stance's angles are added
 * to the clip's, so a walk or a dance keeps the feet as far apart as the
 * stance put them. Without a stance the clip's pose is returned as it is.
 */
export const withStance = (pose: BodyPose, stance: BodyPose | null): BodyPose =>
  stance === null
    ? pose
    : {
        ...pose,
        joints: Object.fromEntries(
          JOINT_IDS.map((id): [JointId, JointRotation] => {
            const clip = pose.joints[id];
            const offset = stance.joints[id];
            return [
              id,
              {
                pitch: clip.pitch + offset.pitch,
                roll: clip.roll + offset.roll,
                yaw: clip.yaw + offset.yaw,
              },
            ];
          }),
        ) as Record<JointId, JointRotation>,
      };
