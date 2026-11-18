import { describe, expect, test } from "bun:test";

import { kioskHintText } from "./kiosk-copy";
import { COUNTDOWN_FROM_MS, type KioskHint, kioskHint } from "./kiosk-hint";
import { ATTRACT, IDLE_RESET_MS } from "./kiosk-session";

const day = (beat: number, lastPressMs = 0) =>
  ({ phase: "day", beat, lastPressMs }) as const;

describe("kioskHint", () => {
  test("nothing in the attract loop, which has its own call", () => {
    expect(kioskHint(ATTRACT, 18, 0)).toBeNull();
  });

  test("says a press goes on, and on the last beat that a press ends", () => {
    expect(kioskHint(day(0), 18, 1000)).toEqual({ kind: "next" });
    expect(kioskHint(day(17), 18, 1000)).toEqual({ kind: "last" });
  });

  test("counts down the last ten seconds before the kiosk goes back", () => {
    const start = IDLE_RESET_MS - COUNTDOWN_FROM_MS;
    expect(kioskHint(day(3), 18, start - 1)).toEqual({ kind: "next" });
    expect(kioskHint(day(3), 18, start)).toEqual({ kind: "leaving", seconds: 10 });
    expect(kioskHint(day(3), 18, start + 500)).toEqual({ kind: "leaving", seconds: 10 });
    expect(kioskHint(day(3), 18, IDLE_RESET_MS - 1)).toEqual({
      kind: "leaving",
      seconds: 1,
    });
  });

  test("the count runs from the last press, not from the start of the day", () => {
    expect(kioskHint(day(5, 40_000), 18, IDLE_RESET_MS + 1000)).toEqual({ kind: "next" });
  });
});

describe("kioskHintText", () => {
  test("says what a press does, and counts in words", () => {
    const hints: readonly KioskHint[] = [
      { kind: "next" },
      { kind: "last" },
      { kind: "leaving", seconds: 10 },
      { kind: "leaving", seconds: 1 },
    ];
    expect(hints.map(kioskHintText)).toEqual([
      "Press anywhere for the next moment.",
      "That was the last moment. Press to finish.",
      "Going back to the start in 10 seconds. Press to stay.",
      "Going back to the start in 1 second. Press to stay.",
    ]);
  });
});
