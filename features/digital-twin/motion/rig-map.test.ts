import { describe, expect, test } from "bun:test";
import { Bone, Group, Quaternion, Vector3 } from "three";

import { walkPose } from "./gait";
import {
  applyPose,
  bindRig,
  normaliseJointName,
  resolveRig,
  restorePose,
} from "./rig-map";

/** ANNY's 104 joint labels as three.js names them (it strips the dots). */
const ANNY_NAMES = [
  "root",
  ...["L", "R"].flatMap((side) => [
    `pelvis${side}`,
    `upperleg01${side}`,
    `upperleg02${side}`,
    `lowerleg01${side}`,
    `lowerleg02${side}`,
    `foot${side}`,
    `toe1-1${side}`,
  ]),
  "spine05",
  "spine04",
  "spine03",
  "spine02",
  "spine01",
  ...["L", "R"].flatMap((side) => [
    `clavicle${side}`,
    `shoulder01${side}`,
    `upperarm01${side}`,
    `upperarm02${side}`,
    `lowerarm01${side}`,
    `lowerarm02${side}`,
    `wrist${side}`,
  ]),
  "neck01",
  "head",
];

/** A Mixamo-style scan skeleton, behind three.js's version of a `mixamorig:` prefix. */
const MIXAMO_NAMES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "HeadTop_End",
  ...["Left", "Right"].flatMap((side) => [
    `${side}Shoulder`,
    `${side}Arm`,
    `${side}ForeArm`,
    `${side}Hand`,
    `${side}UpLeg`,
    `${side}Leg`,
    `${side}Foot`,
    `${side}ToeBase`,
    `${side}Toe_End`,
  ]),
].map((name) => `mixamorig${name}`);

describe("resolveRig", () => {
  test("normalises names the way they are compared", () => {
    expect(normaliseJointName("mixamorig:LeftUpLeg")).toBe("mixamorigleftupleg");
    expect(normaliseJointName("upperleg01.L")).toBe("upperleg01l");
  });

  test("finds ANNY's joints by exact name", () => {
    const rig = resolveRig(ANNY_NAMES);
    expect(rig?.kind).toBe("anny");
    expect(rig?.joints.pelvis).toBe(0);
    expect(ANNY_NAMES[rig?.joints.upperLegL ?? -1]).toBe("upperleg01L");
    expect(ANNY_NAMES[rig?.joints.lowerArmR ?? -1]).toBe("lowerarm01R");
    expect(ANNY_NAMES[rig?.joints.spineUpper ?? -1]).toBe("spine02");
    expect(ANNY_NAMES[rig?.joints.clavicleL ?? -1]).toBe("clavicleL");
  });

  test("finds the scan's joints by suffix, telling Leg from UpLeg and Arm from ForeArm", () => {
    const rig = resolveRig(MIXAMO_NAMES);
    expect(rig?.kind).toBe("mixamo");
    const name = (id: keyof NonNullable<typeof rig>["joints"]) =>
      MIXAMO_NAMES[rig?.joints[id] ?? -1];
    expect(name("pelvis")).toBe("mixamorigHips");
    expect(name("spineLower")).toBe("mixamorigSpine");
    expect(name("spineUpper")).toBe("mixamorigSpine2");
    expect(name("upperLegL")).toBe("mixamorigLeftUpLeg");
    expect(name("lowerLegL")).toBe("mixamorigLeftLeg");
    expect(name("upperArmR")).toBe("mixamorigRightArm");
    expect(name("lowerArmR")).toBe("mixamorigRightForeArm");
    expect(name("clavicleR")).toBe("mixamorigRightShoulder");
  });

  test("a missing or ambiguous required joint means no rig", () => {
    expect(resolveRig(MIXAMO_NAMES.filter((name) => name !== "mixamorigLeftFoot"))).toBe(
      null,
    );
    expect(resolveRig([...MIXAMO_NAMES, "otherLeftFoot"])).toBe(null);
    expect(resolveRig([])).toBe(null);
  });

  test("optional joints may be missing", () => {
    const rig = resolveRig(
      MIXAMO_NAMES.filter((name) => !/Shoulder|Spine1|Spine2/.test(name)),
    );
    expect(rig?.kind).toBe("mixamo");
    expect(rig?.joints.spineUpper).toBeUndefined();
    expect(rig?.joints.clavicleL).toBeUndefined();
  });
});

/**
 * A small scan-frame skeleton (+Z up, faces -Y, +X the subject's left). The
 * left thigh's local frame is turned 90° so the mapping cannot rely on bone axes.
 */
const skeleton = () => {
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
    ["Left", 0.2],
    ["Right", -0.2],
  ] as const) {
    const arm = bone(`${side}Arm`, chest, new Vector3(x, 0, 0.2));
    bone(`${side}ForeArm`, arm, new Vector3(0, 0, -0.3));
    const thigh = bone(`${side}UpLeg`, hips, new Vector3(x / 2, 0, -0.05));
    const turn =
      side === "Left" ? new Quaternion(0, Math.SQRT1_2, 0, Math.SQRT1_2) : null;
    if (turn) thigh.quaternion.copy(turn);
    const down = new Vector3(0, 0, -0.45);
    const local = turn ? down.clone().applyQuaternion(turn.clone().invert()) : down;
    const shin = bone(`${side}Leg`, thigh, local);
    bone(`${side}Foot`, shin, local.clone());
  }
  root.updateWorldMatrix(true, true);
  return root;
};

const world = (root: Group, name: string): Vector3 => {
  const found = root.getObjectByName(`mixamorig${name}`);
  if (!found) throw new Error(name);
  return found.getWorldPosition(new Vector3());
};

describe("bindRig and applyPose", () => {
  test("measures the body frame from the hips and shoulders", () => {
    const binding = bindRig(skeleton());
    expect(binding?.kind).toBe("mixamo");
    expect(binding?.left.toArray()).toEqual([1, 0, 0]);
    expect(binding?.up.toArray()).toEqual([0, 0, 1]);
    expect(round(binding?.restFloor ?? -1)).toBe(0.05);
  });

  test("swings the thighs by the clip in the body frame, whatever the bone axes", () => {
    const root = skeleton();
    const binding = bindRig(root);
    if (!binding) throw new Error("no binding");
    const pose = walkPose(0);
    // Only the legs move, so the expected knee positions are exact.
    const legsOnly = {
      ...pose,
      joints: Object.fromEntries(
        Object.entries(pose.joints).map(([id, joint]) => [
          id,
          id.endsWith("LegL") || id.endsWith("LegR")
            ? joint
            : { pitch: 0, roll: 0, yaw: 0 },
        ]),
      ) as typeof pose.joints,
      pelvisShift: 0,
    };
    applyPose(binding, legsOnly);
    const hipL = world(root, "LeftUpLeg");
    const kneeL = world(root, "LeftLeg").sub(hipL);
    const kneeR = world(root, "RightLeg").sub(world(root, "RightUpLeg"));
    // Left hip flexed 28°: the knee comes forward (−Y); right hip extended 12°: it goes back.
    expect(kneeL.toArray().map((n) => round(n))).toEqual([
      0,
      round(-0.45 * Math.sin((28 * Math.PI) / 180)),
      round(-0.45 * Math.cos((28 * Math.PI) / 180)),
    ]);
    expect(round(kneeR.y)).toBe(round(0.45 * Math.sin((12 * Math.PI) / 180)));
    // The lower foot stays on the floor: the pelvis came down to put it there.
    const feet = [world(root, "LeftFoot").z, world(root, "RightFoot").z];
    expect(round(Math.min(...feet))).toBe(0.05);
    expect(round(world(root, "Hips").z)).toBeLessThan(1);
  });

  test("restorePose puts every bone back exactly", () => {
    const root = skeleton();
    const before = ["LeftLeg", "RightFoot", "LeftForeArm", "Hips"].map((name) =>
      world(root, name).toArray(),
    );
    const binding = bindRig(root);
    if (!binding) throw new Error("no binding");
    applyPose(binding, walkPose(0.3));
    restorePose(binding);
    root.updateWorldMatrix(true, true);
    expect(
      ["LeftLeg", "RightFoot", "LeftForeArm", "Hips"].map((name) =>
        world(root, name)
          .toArray()
          .map((n) => round(n)),
      ),
    ).toEqual(before.map((row) => row.map((n) => round(n))));
  });

  test("a body with no known skeleton has no binding", () => {
    const root = new Group();
    const lone = new Bone();
    lone.name = "Bone";
    root.add(lone);
    expect(bindRig(root)).toBe(null);
  });
});

// "+ 0" turns -0 into 0, so a zero compares equal whatever its sign.
const round = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;
