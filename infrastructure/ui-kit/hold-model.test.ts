import { describe, expect, test } from "bun:test";

import {
  holdCountdown,
  holdHint,
  holdReducer,
  holdSecondsLeft,
  type HoldEvent,
  type HoldPhase,
} from "./hold-model";

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

describe("holdSecondsLeft", () => {
  const cases: readonly [number, number, number][] = [
    [1500, 0, 2],
    [1500, 499, 2],
    [1500, 500, 1],
    [1500, 1499, 1],
    [1500, 1500, 0],
    [1500, 9000, 0],
    [2000, -50, 2],
    [3000, 1, 3],
  ];
  test.each(cases)("%i ms held for %i ms leaves %i", (holdMs, elapsed, left) => {
    expect(holdSecondsLeft(holdMs, elapsed)).toBe(left);
  });
});

describe("holdCountdown", () => {
  test("says to keep holding and how many seconds are left", () => {
    expect(holdCountdown(2)).toBe("Keep holding: 2");
    expect(holdCountdown(1)).toBe("Keep holding: 1");
  });
});
