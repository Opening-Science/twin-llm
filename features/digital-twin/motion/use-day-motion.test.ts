import { describe, expect, test } from "bun:test";

import { type MotionDay } from "./day-motion";
import { dayStatus } from "./day-motion-bar";
import {
  DAY_FAILED,
  DAY_LOADING,
  DAY_NONE_DEMO,
  DAY_NONE_OTHER,
  DAY_NONE_SELF,
  dayLines,
  dayOption,
  DAY_VISUAL_CUE,
  MOTION_HIDES_ANATOMY,
  motionLines,
} from "./motion-copy";
import { dayRates } from "./use-body-motion";
import {
  type DayMotionState,
  daySource,
  parseMotionDays,
  pickDay,
} from "./use-day-motion";

const RUN_DAY: MotionDay = {
  day: "2026-09-28",
  workout: { sport: "running", minutes: 40, distanceM: null, cadence: null },
  breathsPerMinute: 14.2,
};
const REST_DAY: MotionDay = { day: "2026-09-27", workout: null, breathsPerMinute: null };
const SOURCE = "Synthetic person 3, synthetic series";

describe("pickDay, parseMotionDays and daySource", () => {
  test("the chosen day while listed, else the newest", () => {
    expect(pickDay([RUN_DAY, REST_DAY], "2026-09-27")).toBe(REST_DAY);
    expect(pickDay([RUN_DAY, REST_DAY], "2026-01-01")).toBe(RUN_DAY);
    expect(pickDay([RUN_DAY, REST_DAY], null)).toBe(RUN_DAY);
    expect(pickDay([], null)).toBe(null);
  });

  test("a body without a days list is no answer", () => {
    expect(parseMotionDays({ days: [RUN_DAY] })).toEqual([RUN_DAY]);
    expect(parseMotionDays({ error: "x" })).toBe(null);
    expect(parseMotionDays(null)).toBe(null);
  });

  test("names the synthetic person or the linked wearables", () => {
    expect(daySource("demo", "Synthetic person 3")).toBe(SOURCE);
    expect(daySource("demo", "")).toBe("Synthetic person, synthetic series");
    expect(daySource("self", "")).toBe("linked wearables");
  });
});

describe("dayLines", () => {
  test("a run day says it is a visual cue, the cadence, the rate and how it was found", () => {
    expect(
      dayLines(
        {
          clip: "run",
          cadence: 168,
          basis: "assumed",
          speedKmh: 11.1,
          breathsPerMinute: null,
        },
        RUN_DAY,
        SOURCE,
      ),
    ).toEqual([
      "Visual cue, not a physiological simulation.",
      "28 Sept 2026: Running, 40 min (Synthetic person 3, synthetic series). Running in place at 168 steps a minute, 0.99× the generic run: synthetic workouts record no cadence or pace, so 11.1 km/h is assumed from the workout's length.",
    ]);
  });

  test("a recorded pace, a ride and the generic rate say so", () => {
    const lines = (plan: Parameters<typeof dayLines>[0], day: MotionDay) =>
      dayLines(plan, day, "linked wearables")[1];
    expect(
      lines(
        {
          clip: "run",
          cadence: 165,
          basis: "pace",
          speedKmh: 10.1,
          breathsPerMinute: null,
        },
        RUN_DAY,
      ),
    ).toBe(
      "28 Sept 2026: Running, 40 min (linked wearables). Running in place at 165 steps a minute, 0.97× the generic run: estimated from the recorded pace, 10.1 km/h.",
    );
    const ride: MotionDay = {
      ...RUN_DAY,
      workout: { sport: "cycling", minutes: 60, distanceM: null, cadence: null },
    };
    expect(
      dayLines(
        {
          clip: "cycle",
          cadence: 80,
          basis: "generic",
          speedKmh: null,
          breathsPerMinute: null,
        },
        ride,
        "linked wearables",
      ),
    ).toEqual([
      DAY_VISUAL_CUE,
      "28 Sept 2026: Cycling, 60 min (linked wearables). Pedalling in place at 80 turns a minute, 1.00× the generic pedalling: no cadence or pace recorded, so the generic rate.",
      "No bike is drawn.",
    ]);
  });

  test("a rest day and a sport without a clip stand at rest", () => {
    const rest = {
      clip: "idle",
      cadence: null,
      basis: null,
      speedKmh: null,
      breathsPerMinute: null,
    } as const;
    expect(dayLines(rest, REST_DAY, SOURCE)).toEqual([
      DAY_VISUAL_CUE,
      "27 Sept 2026: no workout recorded, so the body stands at rest.",
    ]);
    expect(
      dayLines(
        rest,
        {
          ...RUN_DAY,
          workout: { sport: "strength", minutes: 45, distanceM: null, cadence: null },
        },
        SOURCE,
      )[1],
    ).toBe(
      "28 Sept 2026: Strength, 45 min (Synthetic person 3, synthetic series). There is no clip for it, so the body stands at rest.",
    );
  });

  test("the night lies down breathing at its rate, or lies still without one", () => {
    const sleep = {
      clip: "sleep",
      cadence: null,
      basis: null,
      speedKmh: null,
      breathsPerMinute: 14.2,
    } as const;
    expect(dayLines(sleep, RUN_DAY, SOURCE)).toEqual([
      DAY_VISUAL_CUE,
      "Night ending on 28 Sept 2026: lying on the back. Breathing 14.2 times a minute, the night's respiratory rate (Synthetic person 3, synthetic series).",
      "There is no lying clip: the body is turned at the hips to lie on its back in a resting pose.",
    ]);
    expect(dayLines({ ...sleep, breathsPerMinute: null }, REST_DAY, SOURCE)[1]).toBe(
      "Night ending on 27 Sept 2026: lying on the back. No respiratory rate is recorded for this night, so it lies still.",
    );
  });

  test("the day select names the workout", () => {
    expect(dayOption(RUN_DAY)).toBe("28 Sept 2026 · Running, 40 min");
    expect(dayOption(REST_DAY)).toBe("27 Sept 2026 · no workout");
  });

  test("motion lines use the day's lines while following", () => {
    expect(
      motionLines({ clip: "run", unavailable: null, dayLines: ["a", "b"] }, true),
    ).toEqual(["a", "b", MOTION_HIDES_ANATOMY]);
  });
});

describe("dayRates and dayStatus", () => {
  test("a followed day sets the rates; none are generic", () => {
    expect(
      dayRates({
        clip: "run",
        cadence: 168,
        basis: "assumed",
        speedKmh: 11.1,
        breathsPerMinute: null,
      }),
    ).toEqual({ cadence: 168, breathsPerMinute: null });
    expect(dayRates(null)).toEqual({ cadence: null, breathsPerMinute: null });
  });

  test("says why there is no day: other subject, loading, failed, or none", () => {
    const state = (overrides: Partial<DayMotionState>): DayMotionState => ({
      subject: "demo",
      following: true,
      night: false,
      days: [RUN_DAY],
      selected: RUN_DAY,
      plan: null,
      lines: null,
      onFollow: () => undefined,
      onDay: () => undefined,
      onNight: () => undefined,
      ...overrides,
    });
    expect(dayStatus(state({}))).toBe(null);
    expect(dayStatus(state({ subject: "other" }))).toBe(DAY_NONE_OTHER);
    expect(dayStatus(state({ days: undefined }))).toBe(DAY_LOADING);
    expect(dayStatus(state({ days: null }))).toBe(DAY_FAILED);
    expect(dayStatus(state({ days: [] }))).toBe(DAY_NONE_DEMO);
    expect(dayStatus(state({ subject: "self", days: [] }))).toBe(DAY_NONE_SELF);
  });
});
