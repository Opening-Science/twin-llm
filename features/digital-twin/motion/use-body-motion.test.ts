import { describe, expect, test } from "bun:test";

import {
  MOTION_HIDES_ANATOMY,
  MOTION_LINE,
  MOTION_NO_RIG_DEMO,
  MOTION_NO_RIG_SCAN,
  MOTION_REDUCED,
  motionLines,
  tempoOption,
} from "./motion-copy";
import { motionUnavailable } from "./use-body-motion";

describe("motionUnavailable", () => {
  test("reduced motion wins, then a missing rig, named for the body it is", () => {
    expect(motionUnavailable(true, true, "demo")).toBe(MOTION_REDUCED);
    expect(motionUnavailable(false, false, "demo")).toBe(MOTION_NO_RIG_DEMO);
    expect(motionUnavailable(false, false, "scan")).toBe(MOTION_NO_RIG_SCAN);
    expect(motionUnavailable(true, false, "scan")).toBe(null);
  });

  test("a demo body without a rig names the bake command", () => {
    expect(motionUnavailable(false, false, "demo")).toBe(
      "The demo body that can walk is not installed on this machine. Run bun run anatomy:fetch.",
    );
  });
});

describe("motionLines", () => {
  test("say the walk is generic, and that the anatomy is hidden only when it was shown", () => {
    expect(motionLines({ clip: "walk", unavailable: null }, true)).toEqual([
      "A generic walk cycle, computed from typical joint angles, not this person's gait. Walking in place.",
      MOTION_HIDES_ANATOMY,
    ]);
    expect(motionLines({ clip: "idle", unavailable: null }, false)).toEqual([
      MOTION_LINE.idle,
    ]);
  });

  test("say the dance is computed, not motion capture and not this person's", () => {
    expect(motionLines({ clip: "dance", unavailable: null }, false)).toEqual([
      "A computed dance loop, not motion capture and not this person's movement.",
    ]);
    expect(tempoOption(128)).toBe("128 BPM");
  });

  test("give the reason when nothing can play, and nothing when still or unloaded", () => {
    expect(motionLines({ clip: null, unavailable: MOTION_NO_RIG_SCAN }, false)).toEqual([
      MOTION_NO_RIG_SCAN,
    ]);
    expect(motionLines({ clip: null, unavailable: null }, true)).toEqual([]);
    expect(motionLines(undefined, true)).toEqual([]);
  });
});
