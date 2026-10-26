import { describe, expect, test } from "bun:test";

import {
  ANKLE_RANGE,
  bump,
  DEFAULT_WALK,
  FOOT_PITCH_FLOOR,
  gaitPeriod,
  gaitPhase,
  idlePose,
  JOINT_IDS,
  limbAngles,
  RUN_FLIGHT_LIFT,
  RUN_FOOT_PITCH_FLOOR,
  runLift,
  runLimbAngles,
  runPose,
  shapeAnkle,
  stepWeight,
  walkPose,
  weighPose,
  type BodyPose,
} from "./gait";

const DEG = Math.PI / 180;
const round = (value: number, digits = 6): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;
const degrees = (radians: number): number => round(radians / DEG, 6);

describe("gait timing", () => {
  test("a cycle is two steps: 105 steps a minute is 1.142857 s", () => {
    expect(round(gaitPeriod(105))).toBe(1.142857);
    expect(gaitPeriod(120)).toBe(1);
  });

  test("the phase runs 0 to 1 per cycle and wraps", () => {
    expect(gaitPhase(0, 120)).toBe(0);
    expect(gaitPhase(0.25, 120)).toBe(0.25);
    expect(gaitPhase(1.75, 120)).toBe(0.75);
    expect(round(gaitPhase(0.5, 60))).toBe(0.25);
  });

  test("bump is 1 at its centre, 0 past its half width, and wraps round the cycle", () => {
    expect(bump(0.72, 0.72, 0.25)).toBe(1);
    expect(bump(0.97, 0.72, 0.25)).toBe(0);
    expect(round(bump(0.845, 0.72, 0.25))).toBe(0.5);
    expect(round(bump(0.98, 0.06, 0.08))).toBe(0);
    expect(round(bump(0.99, 0.03, 0.08))).toBe(0.5);
  });
});

describe("limbAngles", () => {
  test("hip flexed 28° at heel strike and extended 12° half a cycle later", () => {
    expect(limbAngles(0).hip).toBe(28);
    expect(limbAngles(0.5).hip).toBe(-12);
  });

  test("the knee bends most in swing, about 58°, and is straight in late stance", () => {
    expect(limbAngles(0.72).knee).toBe(58);
    expect(limbAngles(0.45).knee).toBe(0);
    expect(limbAngles(0.15).knee).toBe(18);
  });

  test("the ankle drops after heel strike and lifts in late stance", () => {
    expect(limbAngles(0.06).ankle).toBe(-6);
    expect(limbAngles(0.42).ankle).toBe(10);
  });

  test("around toe off and in swing the sole never points more than 35° down", () => {
    const sole = (phase: number) => {
      const { hip, knee, ankle } = limbAngles(phase);
      return hip - knee + ankle;
    };
    expect(round(sole(0.6), 3)).toBe(-35);
    expect(round(sole(0.75), 3)).toBe(-35);
    const lowest = Math.min(...Array.from({ length: 1000 }, (_, i) => sole(i / 1000)));
    // The ankle's 20° of dorsiflexion runs out briefly in early swing.
    expect(round(lowest, 1)).toBe(-35.4);
    for (let i = 0; i < 1000; i += 1) {
      const { ankle } = limbAngles(i / 1000);
      expect(ankle).toBeGreaterThanOrEqual(ANKLE_RANGE[0]);
      expect(ankle).toBeLessThanOrEqual(ANKLE_RANGE[1]);
    }
  });

  test("shapeAnkle lifts a toe-down foot to the floor angle, within the ankle's range", () => {
    expect(FOOT_PITCH_FLOOR).toBe(-35);
    expect(shapeAnkle(-8, 31, -16)).toBe(4);
    expect(shapeAnkle(0, 70, 0)).toBe(20);
    expect(shapeAnkle(20, 0, -30)).toBe(-12);
    expect(shapeAnkle(28, 0, -1)).toBe(-1);
  });

  test("the arm swings against its own leg and its elbow bends as it comes forward", () => {
    expect(limbAngles(0)).toMatchObject({ shoulder: -16, elbow: 12 });
    expect(limbAngles(0.5)).toMatchObject({ shoulder: 16, elbow: 22 });
  });
});

describe("walkPose", () => {
  test("at left heel strike the left thigh is forward and the right one back", () => {
    const pose = walkPose(0);
    expect(degrees(pose.joints.upperLegL.pitch)).toBe(28);
    expect(degrees(pose.joints.upperLegR.pitch)).toBe(-12);
    expect(degrees(pose.joints.upperArmL.pitch)).toBe(-16);
    expect(degrees(pose.joints.upperArmR.pitch)).toBe(16);
    expect(degrees(pose.joints.pelvis.yaw)).toBe(-4);
    expect(pose.pelvisShift).toBe(0);
  });

  test("half a cycle later the sides have swapped", () => {
    const period = gaitPeriod(DEFAULT_WALK.cadence);
    const a = walkPose(0.1);
    const b = walkPose(0.1 + period / 2);
    expect(round(b.joints.upperLegL.pitch)).toBe(round(a.joints.upperLegR.pitch));
    expect(round(b.joints.lowerLegR.pitch)).toBe(round(a.joints.lowerLegL.pitch));
    expect(round(b.joints.footL.pitch)).toBe(round(a.joints.footR.pitch));
    expect(round(b.joints.pelvis.roll)).toBe(round(-a.joints.pelvis.roll));
  });

  test("repeats every cycle", () => {
    const period = gaitPeriod(DEFAULT_WALK.cadence);
    const a = walkPose(0.37);
    const b = walkPose(0.37 + 3 * period);
    for (const id of JOINT_IDS) {
      expect(round(b.joints[id].pitch, 9)).toBe(round(a.joints[id].pitch, 9));
    }
  });

  test("a shorter stride scales the sagittal angles, within limits", () => {
    expect(
      degrees(walkPose(0, { cadence: 105, stride: 0.65 }).joints.upperLegL.pitch),
    ).toBe(14);
    expect(
      degrees(walkPose(0, { cadence: 105, stride: 0.1 }).joints.upperLegL.pitch),
    ).toBe(8.4);
    expect(degrees(walkPose(0, { cadence: 105, stride: 3 }).joints.upperLegL.pitch)).toBe(
      39.2,
    );
  });

  test("a faster cadence reaches the same phase sooner", () => {
    const slow = walkPose(0.5, { cadence: 60, stride: 1.3 });
    const fast = walkPose(0.25, { cadence: 120, stride: 1.3 });
    expect(round(fast.joints.upperLegL.pitch)).toBe(round(slow.joints.upperLegL.pitch));
  });
});

describe("runPose", () => {
  test("170 steps a minute: a stride cycle every 0.705882 s", () => {
    expect(round(gaitPeriod(170))).toBe(0.705882);
  });

  test("hip from 12° extension at 0.4 to 44° flexion late in swing; knee 40° loading, 100° in swing", () => {
    expect(round(runLimbAngles(0.4).hip)).toBe(-12);
    expect(round(runLimbAngles(0.9).hip)).toBe(44);
    expect(round(runLimbAngles(0).hip, 3)).toBe(38.652);
    expect(runLimbAngles(0.15).knee).toBe(40);
    expect(runLimbAngles(0.68).knee).toBe(100);
    expect(round(runLimbAngles(0).knee, 2)).toBe(15.84);
  });

  test("more knee and arm bend than the walk", () => {
    const most = (f: (phase: number) => number) =>
      Math.max(...Array.from({ length: 200 }, (_, i) => f(i / 200)));
    expect(most((p) => runLimbAngles(p).knee)).toBeGreaterThan(
      most((p) => limbAngles(p).knee) + 40,
    );
    expect(round(runLimbAngles(0.4).elbow)).toBe(105);
    expect(round(runLimbAngles(0.9).elbow)).toBe(85);
    expect(round(runLimbAngles(0.4).shoulder)).toBe(30);
  });

  test("up to toe off the sole points at most 50° down; the ankle pushes off about 20°", () => {
    const sole = (phase: number) => {
      const { hip, knee, ankle } = runLimbAngles(phase);
      return hip - knee + ankle;
    };
    const lowest = (from: number, to: number) =>
      Math.min(
        ...Array.from({ length: 501 }, (_, i) => sole(from + ((to - from) * i) / 500)),
      );
    expect(round(lowest(0, 0.5), 1)).toBe(RUN_FOOT_PITCH_FLOOR);
    // In mid swing, foot off the ground behind, the ankle's range runs out.
    expect(round(lowest(0.5, 1), 1)).toBe(-62.1);
    expect(round(runLimbAngles(0.42).ankle, 1)).toBe(-19.5);
  });

  test("a flight phase after each toe off: the body lifts 5 cm half way, and never in stance", () => {
    expect(round(runLift(0.44))).toBe(RUN_FLIGHT_LIFT);
    expect(round(runLift(0.94))).toBe(RUN_FLIGHT_LIFT);
    for (const phase of [0, 0.1, 0.2, 0.3, 0.38, 0.5, 0.6, 0.7, 0.8, 0.88]) {
      expect(runLift(phase)).toBe(0);
    }
    expect(runPose(0.44 * gaitPeriod(170)).pelvisLift).toBe(runLift(0.44));
  });

  test("leans about 9° forward and the sides swap half a cycle later", () => {
    const pose = runPose(0.1);
    expect(
      degrees(pose.joints.spineLower.pitch) + degrees(pose.joints.spineUpper.pitch),
    ).toBe(-9);
    const later = runPose(0.1 + gaitPeriod(170) / 2);
    expect(round(later.joints.upperLegL.pitch)).toBe(round(pose.joints.upperLegR.pitch));
    expect(round(later.joints.lowerArmR.pitch)).toBe(round(pose.joints.lowerArmL.pitch));
  });

  test("blending scales the lift too", () => {
    const pose = runPose(0.44 * gaitPeriod(170));
    expect(round(weighPose(pose, 0.5).pelvisLift ?? NaN)).toBe(
      round(RUN_FLIGHT_LIFT / 2),
    );
  });
});

describe("idlePose", () => {
  test("breathes in the chest and shoulders and leaves the limbs alone", () => {
    const pose = idlePose(1.25); // a quarter breath at 12 a minute: fully in
    expect(degrees(pose.joints.spineUpper.pitch)).toBe(0.8);
    expect(degrees(pose.joints.clavicleL.roll)).toBe(1.2);
    expect(degrees(pose.joints.clavicleR.roll)).toBe(-1.2);
    for (const id of [
      "upperLegL",
      "lowerLegR",
      "footL",
      "upperArmR",
      "lowerArmL",
    ] as const) {
      expect(pose.joints[id]).toEqual({ pitch: 0, roll: 0, yaw: 0 });
    }
  });

  test("starts at rest breathing out half way, with no sway", () => {
    const pose = idlePose(0);
    expect(pose.joints.spineUpper.pitch).toBe(0);
    expect(pose.pelvisShift).toBe(0);
    expect(degrees(pose.joints.clavicleL.roll)).toBe(0.6);
  });
});

describe("blending", () => {
  test("weight 0 is the rest pose and 0.5 halves every angle", () => {
    const pose = walkPose(0);
    const rest = weighPose(pose, 0);
    for (const id of JOINT_IDS) {
      expect(Math.abs(rest.joints[id].pitch) + Math.abs(rest.joints[id].roll)).toBe(0);
    }
    const half: BodyPose = weighPose(pose, 0.5);
    expect(degrees(half.joints.upperLegL.pitch)).toBe(14);
  });

  test("the weight moves at a constant rate over 0.4 s and stops at its target", () => {
    expect(stepWeight(0, 1, 0.1)).toBe(0.25);
    expect(stepWeight(0.9, 1, 0.1)).toBe(1);
    expect(stepWeight(0.2, 0, 0.1)).toBe(0);
    expect(stepWeight(0.5, 0, -1)).toBe(0.5);
  });
});
