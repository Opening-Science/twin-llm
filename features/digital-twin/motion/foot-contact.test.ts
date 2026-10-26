import { describe, expect, test } from "bun:test";
import { Bone, Group, Quaternion, Vector3 } from "three";

import { createFootPlanter, reachWithLeg } from "./foot-contact";
import { type BodyPose, JOINT_IDS, type JointId, type JointRotation } from "./gait";
import { applyPose, bindRig, type RigBinding } from "./rig-map";

/** A small Mixamo-named skeleton: +Y up, facing +Z, +X the subject's left, with toes. */
const skeleton = () => {
  const root = new Group();
  const bone = (name: string, parent: Bone | Group, offset: Vector3): Bone => {
    const made = new Bone();
    made.name = `mixamorig${name}`;
    made.position.copy(offset);
    parent.add(made);
    return made;
  };
  const hips = bone("Hips", root, new Vector3(0, 1, 0));
  const spine = bone("Spine", hips, new Vector3(0, 0.1, 0));
  const chest = bone("Spine2", spine, new Vector3(0, 0.3, 0));
  for (const [side, x] of [
    ["Left", 0.1],
    ["Right", -0.1],
  ] as const) {
    const arm = bone(`${side}Arm`, chest, new Vector3(x * 2, 0.2, 0));
    bone(`${side}ForeArm`, arm, new Vector3(0, -0.3, 0));
    const thigh = bone(`${side}UpLeg`, hips, new Vector3(x, -0.05, 0));
    const shin = bone(`${side}Leg`, thigh, new Vector3(0, -0.45, 0));
    const foot = bone(`${side}Foot`, shin, new Vector3(0, -0.42, 0));
    bone(`${side}ToeBase`, foot, new Vector3(0, -0.05, 0.12));
  }
  root.updateWorldMatrix(true, true);
  return root;
};

const at = (root: Group, name: string): Vector3 => {
  const found = root.getObjectByName(`mixamorig${name}`);
  if (!found) throw new Error(name);
  return found.getWorldPosition(new Vector3());
};

const bind = (root: Group): RigBinding => {
  const binding = bindRig(root);
  if (!binding) throw new Error("no binding");
  return binding;
};

const REST: JointRotation = { pitch: 0, roll: 0, yaw: 0 };
const DEG = Math.PI / 180;
const pose = (
  joints: Partial<Record<JointId, JointRotation>>,
  footContact?: BodyPose["footContact"],
): BodyPose => ({
  joints: Object.fromEntries(JOINT_IDS.map((id) => [id, joints[id] ?? REST])) as Record<
    JointId,
    JointRotation
  >,
  pelvisShift: 0,
  ...(footContact ? { footContact } : {}),
});

const round = (value: number): number => Math.round(value * 1e5) / 1e5 + 0;
const rounded = (v: Vector3): number[] => v.toArray().map(round);

describe("reachWithLeg", () => {
  test("puts the ankle on a reachable target, bending the knee forward, foot unturned", () => {
    const root = skeleton();
    const binding = bind(root);
    const foot = root.getObjectByName("mixamorigLeftFoot") as Bone;
    const before = foot.getWorldQuaternion(new Quaternion());
    const target = at(root, "LeftFoot").add(new Vector3(0, 0.15, 0.1));
    const leg = {
      thigh: binding.joints.get("upperLegL")?.bone as Bone,
      shin: binding.joints.get("lowerLegL")?.bone as Bone,
      foot,
      hinge: new Vector3(1, 0, 0),
    };
    reachWithLeg(leg, target, 1);
    expect(rounded(at(root, "LeftFoot"))).toEqual(rounded(target));
    expect(at(root, "LeftLeg").z).toBeGreaterThan(0.1);
    expect(round(foot.getWorldQuaternion(new Quaternion()).angleTo(before))).toBe(0);
  });

  test("weight 0 leaves the leg alone", () => {
    const root = skeleton();
    const binding = bind(root);
    const leg = {
      thigh: binding.joints.get("upperLegL")?.bone as Bone,
      shin: binding.joints.get("lowerLegL")?.bone as Bone,
      foot: binding.joints.get("footL")?.bone as Bone,
      hinge: new Vector3(1, 0, 0),
    };
    const ankle = at(root, "LeftFoot");
    reachWithLeg(leg, ankle.clone().add(new Vector3(0, 0.2, 0)), 0);
    expect(rounded(at(root, "LeftFoot"))).toEqual(rounded(ankle));
  });
});

describe("createFootPlanter", () => {
  test("a planted foot stays where it landed and on the floor while the leg moves", () => {
    const root = skeleton();
    const binding = bind(root);
    const planter = createFootPlanter();
    const planted = { footL: 1, footR: 0, onsetL: 2, onsetR: -1 };
    const first = pose({}, planted);
    applyPose(binding, first);
    planter.plant(binding, first);
    const landed = at(root, "LeftFoot");

    // The clip swings the left thigh forward and points the foot; same footfall.
    const swung = pose(
      {
        upperLegL: { pitch: 20 * DEG, roll: 0, yaw: 0 },
        footL: { pitch: -30 * DEG, roll: 0, yaw: 0 },
      },
      planted,
    );
    applyPose(binding, swung);
    planter.plant(binding, swung);
    const ankle = at(root, "LeftFoot");
    expect([round(ankle.x), round(ankle.z)]).toEqual([round(landed.x), round(landed.z)]);
    // Laid flat again, the toe and ankle are back at their rest heights.
    expect(round(ankle.y)).toBe(round(landed.y));
    // (a straight leg stops 0.1 mm short of full reach)
    expect(Math.round(at(root, "LeftToeBase").y * 1000) / 1000).toBe(0.03);
  });

  test("a new footfall lands where the foot is, and no contact leaves the clip's leg", () => {
    const root = skeleton();
    const binding = bind(root);
    const planter = createFootPlanter();
    const swing = { upperLegL: { pitch: 20 * DEG, roll: 0, yaw: 0 } };
    const firstStep = pose({}, { footL: 1, footR: 0, onsetL: 0, onsetR: -1 });
    applyPose(binding, firstStep);
    planter.plant(binding, firstStep);
    const secondStep = pose(swing, { footL: 1, footR: 0, onsetL: 1, onsetR: -1 });
    applyPose(binding, secondStep);
    const free = at(root, "LeftFoot");
    planter.plant(binding, secondStep);
    // Anchored for the new footfall, ahead where the swung leg put it, not
    // back where the first one landed (it then reaches down toward the floor).
    expect(free.z).toBeGreaterThan(0.29);
    expect(at(root, "LeftFoot").z).toBeGreaterThan(0.28);

    const lifted = pose(swing);
    applyPose(binding, lifted);
    const fk = at(root, "LeftFoot");
    planter.plant(binding, lifted);
    expect(rounded(at(root, "LeftFoot"))).toEqual(rounded(fk));
  });
});

describe("applyPose with both feet planted", () => {
  test("the higher foot goes to the floor, so bent knees keep the hips low", () => {
    const root = skeleton();
    const binding = bind(root);
    const bend = {
      upperLegL: { pitch: 30 * DEG, roll: 0, yaw: 0 },
      lowerLegL: { pitch: -60 * DEG, roll: 0, yaw: 0 },
      footL: { pitch: 30 * DEG, roll: 0, yaw: 0 },
    };
    applyPose(binding, pose(bend));
    const oneFoot = at(root, "Hips").y;
    applyPose(binding, pose(bend, { footL: 1, footR: 1, onsetL: 0, onsetR: 0 }));
    const bothFeet = at(root, "Hips").y;
    // The bent left leg is shorter by 0.87 · (1 − cos 30°) ≈ 0.117 m.
    expect(round(oneFoot)).toBe(1);
    expect(round(oneFoot - bothFeet)).toBe(round(0.87 * (1 - Math.cos(30 * DEG))));
    expect(round(Math.min(at(root, "LeftFoot").y, at(root, "LeftToeBase").y))).toBe(0.03);
  });
});
