import { describe, expect, test } from "bun:test";

import { clipPose, clipRate, GENERIC_RATES, retimeRate } from "./clip-pose";
import { cyclePose } from "./cycle-pose";
import { dancePose } from "./dance";
import { idlePose, runPose, walkPose } from "./gait";
import { sleepPose } from "./sleep-pose";

describe("clipPose", () => {
  test("plays each clip, and only the dance follows the tempo", () => {
    expect(clipPose("walk", 0.3, 90)).toEqual(walkPose(0.3));
    expect(clipPose("idle", 2, 90)).toEqual(idlePose(2));
    expect(clipPose("dance", 2, 90)).toEqual(dancePose(2, 90));
    expect(clipPose("dance", 2)).toEqual(dancePose(2, 110));
  });

  test("a wearable day's cadence sets the walk, run and cycle; its breathing the sleep", () => {
    const rates = { cadence: 168, breathsPerMinute: 14 };
    expect(clipPose("run", 0.3, 110, null, rates)).toEqual(
      runPose(0.3, { cadence: 168 }),
    );
    expect(clipPose("walk", 0.3, 110, null, { ...rates, cadence: 112 })).toEqual(
      walkPose(0.3, { cadence: 112, stride: 1.3 }),
    );
    expect(clipPose("cycle", 0.3, 110, null, { ...rates, cadence: 84 })).toEqual(
      cyclePose(0.3, { rpm: 84 }),
    );
    expect(clipPose("sleep", 2, 110, null, rates)).toEqual(
      sleepPose(2, { breathsPerMinute: 14 }),
    );
    expect(clipPose("run", 0.3, 110, null, GENERIC_RATES)).toEqual(runPose(0.3));
  });
});

describe("clipRate and retimeRate", () => {
  test("the rate behind each clip, generic without a day", () => {
    expect(clipRate("run", GENERIC_RATES)).toBe(170);
    expect(clipRate("walk", GENERIC_RATES)).toBe(105);
    expect(clipRate("cycle", GENERIC_RATES)).toBe(80);
    expect(clipRate("run", { cadence: 180, breathsPerMinute: null })).toBe(180);
    expect(clipRate("sleep", { cadence: null, breathsPerMinute: 14 })).toBe(14);
    expect(clipRate("sleep", GENERIC_RATES)).toBe(null);
    expect(clipRate("dance", GENERIC_RATES)).toBe(null);
  });

  test("a new rate keeps the phase reached", () => {
    expect(retimeRate(3, 170, 340)).toBe(1.5);
    expect(retimeRate(3, 170, 0)).toBe(3);
  });
});
