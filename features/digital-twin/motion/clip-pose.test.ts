import { describe, expect, test } from "bun:test";

import { clipPose } from "./clip-pose";
import { dancePose } from "./dance";
import { idlePose, walkPose } from "./gait";

describe("clipPose", () => {
  test("plays each clip, and only the dance follows the tempo", () => {
    expect(clipPose("walk", 0.3, 90)).toEqual(walkPose(0.3));
    expect(clipPose("idle", 2, 90)).toEqual(idlePose(2));
    expect(clipPose("dance", 2, 90)).toEqual(dancePose(2, 90));
    expect(clipPose("dance", 2)).toEqual(dancePose(2, 110));
  });
});
