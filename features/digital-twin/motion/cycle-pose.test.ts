import { describe, expect, test } from "bun:test";

import {
  CRANK_RADIUS_M,
  cycleLift,
  cyclePeriod,
  cyclePose,
  CYCLE_SHIN_M,
  CYCLE_THIGH_M,
  legToPedal,
  pedalPoint,
} from "./cycle-pose";

const DEG = Math.PI / 180;
const round = (value: number, digits = 6): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/** The ankle's place from the hip for hip and knee flexion in degrees. */
const ankleAt = (hip: number, knee: number) => {
  const thigh = hip * DEG;
  const shin = (hip - knee) * DEG;
  return {
    forward: CYCLE_THIGH_M * Math.sin(thigh) + CYCLE_SHIN_M * Math.sin(shin),
    up: -CYCLE_THIGH_M * Math.cos(thigh) - CYCLE_SHIN_M * Math.cos(shin),
  };
};

describe("cycle timing", () => {
  test("one crank turn at 80 rpm lasts 0.75 s", () => {
    expect(cyclePeriod(80)).toBe(0.75);
    expect(cyclePeriod(60)).toBe(1);
  });
});

describe("legToPedal", () => {
  test("puts the ankle on the pedal all round the stroke", () => {
    for (const angle of [0, 0.7, Math.PI / 2, 2, Math.PI, 4, (3 * Math.PI) / 2, 5.5]) {
      const leg = legToPedal(angle);
      const ankle = ankleAt(leg.hip, leg.knee);
      const pedal = pedalPoint(angle);
      expect(round(ankle.forward, 9)).toBe(round(pedal.forward, 9));
      expect(round(ankle.up, 9)).toBe(round(pedal.up, 9));
    }
  });

  test("the knee bends about 107° at the top of the stroke and 30° at the bottom", () => {
    expect(round(legToPedal(0).knee, 1)).toBe(107.2);
    expect(round(legToPedal(Math.PI).knee, 1)).toBe(30.4);
  });
});

describe("cyclePose", () => {
  test("the legs are half a turn apart and the clip repeats each turn", () => {
    const pose = cyclePose(0, { rpm: 60 });
    const half = cyclePose(0.5, { rpm: 60 });
    expect(round(half.joints.upperLegL.pitch)).toBe(round(pose.joints.upperLegR.pitch));
    expect(round(half.joints.lowerLegR.pitch)).toBe(round(pose.joints.lowerLegL.pitch));
    const turn = cyclePose(1, { rpm: 60 });
    expect(round(turn.joints.upperLegL.pitch)).toBe(round(pose.joints.upperLegL.pitch));
  });

  test("the lift keeps the hips level: zero with a pedal at the bottom, the crank radius between", () => {
    expect(cycleLift(0)).toBe(0);
    expect(round(cycleLift(Math.PI / 2))).toBe(CRANK_RADIUS_M);
    expect(cyclePose(0).pelvisLift).toBe(0);
  });

  test("leans the trunk about 40° forward with the head lifted", () => {
    const pose = cyclePose(0);
    expect(
      round((pose.joints.spineLower.pitch + pose.joints.spineUpper.pitch) / DEG),
    ).toBe(-40);
    expect(round(pose.joints.head.pitch / DEG)).toBe(30);
  });
});
