import { describe, expect, test } from "bun:test";
import { Bone, Group, Quaternion, Vector3 } from "three";

import { adductionToReach } from "@/packages/anatomy/stance";

import { JOINT_IDS, walkPose } from "./gait";
import { applyPose, bindRig } from "./rig-map";
import { stancePose, withStance } from "./stance-pose";

/**
 * A scan-frame skeleton (+Z up, +X the subject's left) standing wide like
 * ANNY: hips 0.2 m apart, ankles 0.4 m apart, 5 cm above the floor.
 */
const wideSkeleton = () => {
  const root = new Group();
  const bone = (name: string, parent: Bone | Group, offset: Vector3): Bone => {
    const made = new Bone();
    made.name = `mixamorig${name}`;
    made.position.copy(offset);
    parent.add(made);
    return made;
  };
  const hips = bone("Hips", root, new Vector3(0, 0, 1));
  const spine = bone("Spine", hips, new Vector3(0, 0, 0.1));
  const chest = bone("Spine2", spine, new Vector3(0, 0, 0.3));
  for (const [side, x] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    const arm = bone(`${side}Arm`, chest, new Vector3(0.2 * x, 0, 0.2));
    bone(`${side}ForeArm`, arm, new Vector3(0, 0, -0.3));
    const thigh = bone(`${side}UpLeg`, hips, new Vector3(0.1 * x, 0, -0.05));
    const shin = bone(`${side}Leg`, thigh, new Vector3(0.05 * x, 0, -0.45));
    const foot = bone(`${side}Foot`, shin, new Vector3(0.05 * x, 0, -0.45));
    bone(`${side}ToeBase`, foot, new Vector3(0, -0.12, -0.04));
  }
  root.updateWorldMatrix(true, true);
  return root;
};

const node = (root: Group, name: string) => {
  const found = root.getObjectByName(`mixamorig${name}`);
  if (!found) throw new Error(name);
  return found;
};
const at = (root: Group, name: string): Vector3 =>
  node(root, name).getWorldPosition(new Vector3());

describe("stancePose", () => {
  test("turns the hips in and the ankles back by the same angle, nothing else", () => {
    const pose = stancePose({ hipAdductionDeg: 9 });
    const angle = (9 * Math.PI) / 180;
    expect(pose.joints.upperLegL.roll).toBeCloseTo(-angle, 12);
    expect(pose.joints.upperLegR.roll).toBeCloseTo(angle, 12);
    expect(pose.joints.footL.roll).toBeCloseTo(angle, 12);
    expect(pose.joints.footR.roll).toBeCloseTo(-angle, 12);
    const others = JOINT_IDS.filter(
      (id) => !["upperLegL", "upperLegR", "footL", "footR"].includes(id),
    );
    for (const id of others)
      expect(pose.joints[id]).toEqual({ pitch: 0, roll: 0, yaw: 0 });
    expect(pose.pelvisShift).toBe(0);
  });

  test("on a wide rig, the angle from adductionToReach puts the ankles over the target, flat and on the floor", () => {
    const root = wideSkeleton();
    const binding = bindRig(root);
    if (!binding) throw new Error("no rig");
    const hip = at(root, "LeftUpLeg");
    const ankle = at(root, "LeftFoot");
    const toeRest = at(root, "LeftToeBase").sub(ankle);
    const floor = Math.min(ankle.z, at(root, "LeftToeBase").z);
    const angle = adductionToReach(hip, ankle, 0.08, 0);
    if (angle === null) throw new Error("out of reach");

    applyPose(binding, stancePose({ hipAdductionDeg: (angle * 180) / Math.PI }));
    root.updateWorldMatrix(true, true);
    const left = at(root, "LeftFoot");
    const right = at(root, "RightFoot");
    expect(left.x).toBeCloseTo(0.08, 6);
    expect(right.x).toBeCloseTo(-0.08, 6);
    // The sole keeps its rest direction, and the lowest foot point its height.
    expect(at(root, "LeftToeBase").sub(left).distanceTo(toeRest)).toBeLessThan(1e-6);
    expect(Math.min(left.z, at(root, "LeftToeBase").z)).toBeCloseTo(floor, 6);
    expect(
      node(root, "LeftFoot")
        .getWorldQuaternion(new Quaternion())
        .angleTo(new Quaternion()),
    ).toBeLessThan(1e-6);
  });
});

describe("withStance", () => {
  test("adds the stance to a clip's angles and keeps the rest of the pose", () => {
    const clip = walkPose(0.3);
    const stance = stancePose({ hipAdductionDeg: 7 });
    const both = withStance(clip, stance);
    expect(both.joints.upperLegL.pitch).toBeCloseTo(clip.joints.upperLegL.pitch, 12);
    expect(both.joints.upperLegL.roll).toBeCloseTo(
      clip.joints.upperLegL.roll + stance.joints.upperLegL.roll,
      12,
    );
    expect(both.joints.footR.roll).toBeCloseTo(
      clip.joints.footR.roll + stance.joints.footR.roll,
      12,
    );
    expect(both.joints.spineLower).toEqual(clip.joints.spineLower);
    expect(both.pelvisShift).toBe(clip.pelvisShift);
  });

  test("without a stance the clip is returned unchanged", () => {
    const clip = walkPose(0.3);
    expect(withStance(clip, null)).toBe(clip);
  });
});
