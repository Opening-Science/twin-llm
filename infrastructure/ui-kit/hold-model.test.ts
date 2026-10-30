import { describe, expect, test } from "bun:test";

import { holdHint, holdReducer, type HoldEvent, type HoldPhase } from "./hold-model";

describe("holdReducer", () => {
  const cases: readonly [HoldPhase, HoldEvent, HoldPhase][] = [
    ["idle", "press", "holding"],
    ["idle", "release", "idle"],
    ["idle", "complete", "idle"],
    ["holding", "release", "idle"],
    ["holding", "leave", "idle"],
    ["holding", "press", "holding"],
    ["holding", "complete", "done"],
    ["done", "press", "done"],
    ["done", "complete", "done"],
    ["done", "release", "done"],
    ["done", "reset", "idle"],
    ["holding", "reset", "idle"],
  ];
  test.each(cases)("%s + %s → %s", (phase, event, next) => {
    expect(holdReducer(phase, event)).toBe(next);
  });
});

describe("holdHint", () => {
  test("states the hold time and the keyboard keys", () => {
    expect(holdHint(1500)).toBe(
      "Press and hold for 1.5 seconds to confirm. With a keyboard, hold Space or Enter.",
    );
    expect(holdHint(2000)).toBe(
      "Press and hold for 2 seconds to confirm. With a keyboard, hold Space or Enter.",
    );
    expect(holdHint(1000)).toBe(
      "Press and hold for 1 second to confirm. With a keyboard, hold Space or Enter.",
    );
  });
});
