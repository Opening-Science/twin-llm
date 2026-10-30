import { describe, expect, test } from "bun:test";

import {
  assumedRate,
  breathPeriod,
  cadenceFromSpeed,
  type DayWorkout,
  dayPlan,
  type MotionDay,
  playbackRate,
  recordedSpeed,
  REFERENCE_CADENCE,
  workoutCadence,
  workoutClip,
} from "./day-motion";

const workout = (overrides: Partial<DayWorkout> = {}): DayWorkout => ({
  sport: "running",
  minutes: 40,
  distanceM: null,
  cadence: null,
  ...overrides,
});

const day = (overrides: Partial<MotionDay> = {}): MotionDay => ({
  day: "2026-09-28",
  workout: workout(),
  breathsPerMinute: 14.2,
  ...overrides,
});

describe("workoutClip", () => {
  test("the sport picks run, walk or cycle; anything else stands at rest", () => {
    expect(workoutClip("running")).toBe("run");
    expect(workoutClip("Treadmill")).toBe("run");
    expect(workoutClip("walking")).toBe("walk");
    expect(workoutClip("Hiking")).toBe("walk");
    expect(workoutClip("cycling")).toBe("cycle");
    expect(workoutClip("indoor_biking")).toBe("cycle");
    expect(workoutClip("strength")).toBe("idle");
    expect(workoutClip("swimming")).toBe("idle");
    expect(workoutClip("functional_fitness")).toBe("idle");
  });
});

describe("cadence from pace", () => {
  test("running is 135 + 3 × km/h within 150–195, walking 47 + 13 × km/h within 80–135", () => {
    expect(cadenceFromSpeed("run", 10)).toBe(165);
    expect(cadenceFromSpeed("run", 15)).toBe(180);
    expect(cadenceFromSpeed("run", 3)).toBe(150);
    expect(cadenceFromSpeed("run", 30)).toBe(195);
    expect(cadenceFromSpeed("walk", 5)).toBe(112);
    expect(cadenceFromSpeed("walk", 1)).toBe(80);
    expect(cadenceFromSpeed("walk", 9)).toBe(135);
  });

  test("recorded speed needs a distance and minutes above zero", () => {
    expect(recordedSpeed(10_000, 60)).toBe(10);
    expect(recordedSpeed(5230, 31)).toBe(10.1);
    expect(recordedSpeed(null, 31)).toBe(null);
    expect(recordedSpeed(5230, null)).toBe(null);
    expect(recordedSpeed(0, 31)).toBe(null);
  });

  test("the synthetic assumption: a shorter session is a faster one, clamped at 20 and 90 minutes", () => {
    expect(assumedRate("run", 20)).toBe(12);
    expect(assumedRate("run", 40)).toBe(11.1);
    expect(assumedRate("run", 90)).toBe(9);
    expect(assumedRate("run", 10)).toBe(12);
    expect(assumedRate("run", 120)).toBe(9);
    expect(assumedRate("walk", 45)).toBe(5.1);
    expect(assumedRate("cycle", 60)).toBe(84.3);
  });
});

describe("workoutCadence", () => {
  test("a plausible recorded cadence is used as it is", () => {
    expect(workoutCadence("run", workout({ cadence: 172.4 }), false)).toEqual({
      cadence: 172,
      basis: "recorded",
      speedKmh: null,
    });
  });

  test("an implausible recorded cadence falls through to the pace", () => {
    expect(
      workoutCadence(
        "run",
        workout({ cadence: 900, distanceM: 5230, minutes: 31 }),
        false,
      ),
    ).toEqual({ cadence: 165, basis: "pace", speedKmh: 10.1 });
  });

  test("synthetic minutes alone give an assumed pace; a person's data never does", () => {
    expect(workoutCadence("run", workout(), true)).toEqual({
      cadence: 168,
      basis: "assumed",
      speedKmh: 11.1,
    });
    expect(
      workoutCadence("cycle", workout({ sport: "cycling", minutes: 60 }), true),
    ).toEqual({ cadence: 84, basis: "assumed", speedKmh: null });
    expect(workoutCadence("run", workout(), false)).toEqual({
      cadence: 170,
      basis: "generic",
      speedKmh: null,
    });
  });

  test("cycling pace says nothing about cadence, so a person's ride keeps the generic rate", () => {
    expect(
      workoutCadence(
        "cycle",
        workout({ sport: "cycling", distanceM: 30_000, minutes: 60 }),
        false,
      ),
    ).toEqual({ cadence: REFERENCE_CADENCE.cycle, basis: "generic", speedKmh: null });
  });
});

describe("playbackRate and breathPeriod", () => {
  test("the rate is the cadence over the clip's own", () => {
    expect(playbackRate("run", 170)).toBe(1);
    expect(playbackRate("run", 187)).toBe(1.1);
    expect(playbackRate("walk", 112)).toBe(1.07);
    expect(playbackRate("cycle", 90)).toBe(1.13);
  });

  test("a breath lasts 60 / rate seconds; a missing or implausible rate gives none", () => {
    expect(breathPeriod(12)).toBe(5);
    expect(breathPeriod(14.2)).toBe(4.225);
    expect(breathPeriod(null)).toBe(null);
    expect(breathPeriod(2)).toBe(null);
    expect(breathPeriod(61)).toBe(null);
    expect(breathPeriod(Number.NaN)).toBe(null);
  });
});

describe("dayPlan", () => {
  test("a run day runs at its cadence", () => {
    expect(dayPlan(day(), false, true)).toEqual({
      clip: "run",
      cadence: 168,
      basis: "assumed",
      speedKmh: 11.1,
      breathsPerMinute: null,
    });
  });

  test("a strength day and a day without a workout stand at rest", () => {
    const rest = {
      clip: "idle",
      cadence: null,
      basis: null,
      speedKmh: null,
      breathsPerMinute: null,
    };
    expect(
      dayPlan(day({ workout: workout({ sport: "strength" }) }), false, true),
    ).toEqual(rest);
    expect(dayPlan(day({ workout: null }), false, true)).toEqual(rest);
  });

  test("at night the body sleeps, breathing at the night's rate or not at all", () => {
    expect(dayPlan(day(), true, true)).toEqual({
      clip: "sleep",
      cadence: null,
      basis: null,
      speedKmh: null,
      breathsPerMinute: 14.2,
    });
    expect(dayPlan(day({ breathsPerMinute: 90 }), true, true).breathsPerMinute).toBe(
      null,
    );
    expect(dayPlan(day({ breathsPerMinute: null }), true, false).breathsPerMinute).toBe(
      null,
    );
  });
});
