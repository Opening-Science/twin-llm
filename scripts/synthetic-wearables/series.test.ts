import { describe, expect, test } from "bun:test";

import { hash32, mulberry32, randomFor } from "./random";
import {
  generateSeries,
  subjectProfile,
  WEARABLE_METRIC_NAMES,
  WEARABLE_METRICS,
  windowDays,
} from "./series";

const OPTIONS = {
  seed: 4242,
  subjectRef: "subject-0001",
  endDay: "2026-10-01",
  days: 90,
} as const;

describe("random", () => {
  test("hash32 and mulberry32 give fixed numbers", () => {
    expect(hash32("")).toBe(2166136261);
    expect(hash32("4242:subject-0001")).toBe(hash32("4242:subject-0001"));
    const random = mulberry32(42);
    expect([random(), random()]).toEqual([0.6011037519201636, 0.44829055899754167]);
  });

  test("a different key gives a different stream", () => {
    expect(randomFor(1, "a")()).not.toBe(randomFor(1, "b")());
  });
});

describe("windowDays", () => {
  test("ends on the end day, oldest first", () => {
    expect(windowDays("2026-10-01", 3)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
  });
});

describe("subjectProfile", () => {
  test("is fixed for a seed and subject", () => {
    expect(subjectProfile(4242, "subject-0001")).toEqual({
      restingHr: 61.7,
      hrv: 65.5,
      sleepMinutes: 464.9,
      steps: 11259,
      respiration: 16.8,
      wearRate: 0.899,
      restingDriftPerDay: 0.0095,
      episode: null,
    });
  });
});

describe("generateSeries", () => {
  test("gives exact values for a fixed seed", () => {
    const series = generateSeries(OPTIONS);
    expect(series.length).toBe(567);
    expect(series.slice(0, 7)).toEqual([
      { day: "2026-07-04", metric: "heart_rate", value: 74 },
      { day: "2026-07-04", metric: "resting_heart_rate", value: 61 },
      { day: "2026-07-04", metric: "hrv_rmssd", value: 70 },
      { day: "2026-07-04", metric: "sleep_duration", value: 459 },
      { day: "2026-07-04", metric: "sleep_score", value: 81 },
      { day: "2026-07-04", metric: "steps", value: 8813 },
      { day: "2026-07-04", metric: "respiratory_rate", value: 16.3 },
    ]);
  });

  test("is deterministic, and a new seed changes it", () => {
    expect(generateSeries(OPTIONS)).toEqual(generateSeries(OPTIONS));
    expect(generateSeries({ ...OPTIONS, seed: 9001 })).not.toEqual(
      generateSeries(OPTIONS),
    );
  });

  test("a worn day has every metric, a missed day none", () => {
    const series = generateSeries(OPTIONS);
    const days = new Set(series.map((reading) => reading.day));
    expect(series.length).toBe(days.size * WEARABLE_METRIC_NAMES.length);
  });

  test("stays inside plausible ranges for 200 subjects", () => {
    const limits = {
      heart_rate: [45, 120],
      resting_heart_rate: [45, 90],
      hrv_rmssd: [10, 150],
      sleep_duration: [240, 600],
      sleep_score: [30, 100],
      steps: [500, 30000],
      respiratory_rate: [10, 24],
    } as const;
    const outside = Array.from({ length: 200 }, (_, index) =>
      generateSeries({ ...OPTIONS, subjectRef: `s${index}` }),
    )
      .flat()
      .filter((reading) => {
        const [low, high] = limits[reading.metric];
        return reading.value < low || reading.value > high;
      });
    expect(outside).toEqual([]);
  });

  test("uses the open-twin LOINC and UCUM codes", () => {
    expect(
      WEARABLE_METRIC_NAMES.map((name) => [
        WEARABLE_METRICS[name].code,
        WEARABLE_METRICS[name].unit,
      ]),
    ).toEqual([
      ["8867-4", "/min"],
      ["40443-4", "/min"],
      ["hrv-rmssd", "ms"],
      ["93832-4", "min"],
      ["sleep-score", "{score}"],
      ["41950-7", "{steps}/d"],
      ["9279-1", "/min"],
    ]);
  });
});
