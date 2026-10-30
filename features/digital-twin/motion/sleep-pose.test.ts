import { describe, expect, test } from "bun:test";

import { SLEEP_LIFT_M, sleepBreath, sleepPose } from "./sleep-pose";

const DEG = Math.PI / 180;
const round = (value: number, digits = 6): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

describe("sleepPose", () => {
  test("lies on the back across the view: the pelvis pitched back 90° and turned 90°", () => {
    const pose = sleepPose(0, { breathsPerMinute: 12 });
    expect(round(pose.joints.pelvis.pitch / DEG)).toBe(90);
    expect(round(pose.joints.pelvis.yaw / DEG)).toBe(90);
    expect(pose.pelvisLift).toBe(SLEEP_LIFT_M);
  });

  test("breathes once per 60 / rate seconds: fully in a quarter breath in", () => {
    expect(sleepBreath(0, 12)).toBe(0);
    expect(round(sleepBreath(1.25, 12))).toBe(1);
    expect(round(sleepBreath(3.75, 12))).toBe(-1);
    expect(
      round(sleepPose(1.25, { breathsPerMinute: 12 }).joints.spineUpper.pitch / DEG),
    ).toBe(1.6);
  });

  test("without a rate the chest is still", () => {
    expect(sleepBreath(1.25, null)).toBe(0);
    expect(sleepPose(1.25, { breathsPerMinute: null })).toEqual(
      sleepPose(7, { breathsPerMinute: null }),
    );
  });
});
