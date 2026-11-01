import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { type SubjectCondition } from "./conditions";

import { hash32, mulberry32, randomFor } from "./random";
import { generateWorkouts } from "./workouts";
import {
  DAILY_METRICS,
  generateSeries,
  seriesEpisodeFlags,
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
  test("gives exact values for a fixed seed (v2)", () => {
    const series = generateSeries({ ...OPTIONS, generatorVersion: "2" });
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
    expect(series.length).toBe(days.size * Object.keys(DAILY_METRICS).length);
    const v2 = generateSeries({ ...OPTIONS, generatorVersion: "2" });
    expect(v2.length).toBe(days.size * WEARABLE_METRIC_NAMES.length);
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
      spo2_mean: [80, 100],
      spo2_min: [70, 100],
      irregular_rhythm_notifications: [0, 2],
      af_burden: [0, 1],
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

describe("generateSeries with conditions (v3)", () => {
  // sha256 of 50 subjects' v2 series and workouts, taken from generator v2
  // before v3 existed. `generatorVersion: "2"` must keep it exactly.
  const V2_SHA256 = "4920a858b5abf731fa3e1c3a2c24a55900d984b763e1e470e527f6f5374e462f";
  const ONSET = "2026-08-20";
  const AF: readonly SubjectCondition[] = [
    { kind: "atrial_fibrillation", onset: ONSET, abatement: null },
  ];
  const fifty = (
    generatorVersion: "2" | "3.1",
    conditions?: readonly SubjectCondition[],
  ) =>
    Array.from({ length: 50 }, (_, index) => {
      const options = {
        ...OPTIONS,
        subjectRef: `s${index}`,
        conditions,
        generatorVersion,
      };
      const daily = generateSeries(options);
      return [...daily, ...generateWorkouts(options, daily)];
    });
  const sha256 = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");

  test("version 2 gives exactly the v2 series, conditions or not", () => {
    expect(sha256(fifty("2"))).toBe(V2_SHA256);
    expect(sha256(fifty("2", AF))).toBe(V2_SHA256);
  });

  test("3.1 moved only the AF days: other v3 series are the v3 ones exactly (#365)", () => {
    // sha256 of 50 subjects' series and workouts, taken from generator 3
    // before the AF calibration.
    const v3None = "b62cbec543da77bfa7e8372143bba70b85aa95f64daa2aa0e6b1facc0f4cb1b4";
    const v3NoAf = "6362b59ab6e5a4b77fcf9887834f5cd6772175d5851e4d44c706d30ea38416e3";
    const noAf: SubjectCondition[] = (
      ["heart_failure", "stroke", "sleep_apnea"] as const
    ).map((kind) => ({ kind, onset: ONSET, abatement: null }));
    expect(sha256(fifty("3.1"))).toBe(v3None);
    expect(sha256(fifty("3.1", noAf))).toBe(v3NoAf);
    // Generator 3 gave 23fde7bd...; 3.1 changes heart rate, resting heart rate
    // and RMSSD on the AF days (docs/training-data.md, "Condition effects").
    expect(sha256(fifty("3.1", AF))).toBe(
      "2242948576c481baacad39b0f1b6df029b47562c36eacfa7afeea731ded02c09",
    );
  });

  test("a healthy subject keeps the v2 values of the v2 metrics outside episodes", () => {
    const v2Metrics = new Set(WEARABLE_METRIC_NAMES as string[]);
    const changed = Array.from({ length: 50 }, (_, index) => {
      const options = { ...OPTIONS, subjectRef: `s${index}` };
      const days = windowDays(options.endDay, options.days);
      const v3Flags = seriesEpisodeFlags(options);
      const v2Flags = seriesEpisodeFlags({ ...options, generatorVersion: "2" });
      const episodeDays = new Set(
        days.filter((_, day) => v3Flags[day] === true || v2Flags[day] === true),
      );
      const quiet = (reading: { day: string }) => !episodeDays.has(reading.day);
      const v3 = generateSeries(options).filter(
        (reading) => v2Metrics.has(reading.metric) && quiet(reading),
      );
      const v2 = generateSeries({ ...options, generatorVersion: "2" }).filter(quiet);
      return { episodeDays: episodeDays.size, same: Bun.deepEquals(v3, v2) };
    });
    expect(changed.every((subject) => subject.same)).toBe(true);
    expect(changed.some((subject) => subject.episodeDays > 0)).toBe(true);
  });

  test("a healthy and an AF subject have the same metrics on the same days", () => {
    const metricDays = (conditions?: readonly SubjectCondition[]) =>
      generateSeries({ ...OPTIONS, conditions }).map(
        (reading) => `${reading.day}:${reading.metric}`,
      );
    expect(metricDays(AF)).toEqual(metricDays());
    expect(metricDays([{ kind: "sleep_apnea", onset: ONSET, abatement: null }])).toEqual(
      metricDays(),
    );
  });

  test("nothing changes before the onset day", () => {
    for (const kind of [
      "atrial_fibrillation",
      "heart_failure",
      "stroke",
      "sleep_apnea",
    ] as const) {
      const before = (conditions?: readonly SubjectCondition[]) =>
        generateSeries({ ...OPTIONS, conditions }).filter(
          (reading) => reading.day < ONSET,
        );
      expect(before([{ kind, onset: ONSET, abatement: null }])).toEqual(before());
    }
  });

  test("AF burden is above 0 only from onset; a healthy subject's is always 0", () => {
    const burden = (conditions?: readonly SubjectCondition[]) =>
      generateSeries({ ...OPTIONS, conditions }).filter(
        (reading) => reading.metric === "af_burden",
      );
    const af = burden(AF).filter((reading) => reading.value > 0);
    expect(af.length).toBeGreaterThan(0);
    expect(af.every((reading) => reading.day >= ONSET)).toBe(true);
    expect(burden().every((reading) => reading.value === 0)).toBe(true);
  });

  test("notifications come with episodes; elsewhere only rare false positives", () => {
    const notified = (conditions?: readonly SubjectCondition[]) =>
      generateSeries({ ...OPTIONS, conditions })
        .filter(
          (reading) =>
            reading.metric === "irregular_rhythm_notifications" && reading.value > 0,
        )
        .reduce((sum, reading) => sum + reading.value, 0);
    expect(notified(AF)).toBeGreaterThan(notified());
    // About one a year: 200 healthy subjects over 90 days give roughly 50.
    const healthy = Array.from({ length: 200 }, (_, index) =>
      generateSeries({ ...OPTIONS, subjectRef: `s${index}` }),
    )
      .flat()
      .filter((reading) => reading.metric === "irregular_rhythm_notifications")
      .reduce((sum, reading) => sum + reading.value, 0);
    expect(healthy).toBeGreaterThan(10);
    expect(healthy).toBeLessThan(120);
  });

  test("an episode day has a faster heart rate and a higher RMSSD than the healthy day", () => {
    const healthy = generateSeries(OPTIONS);
    const v3 = generateSeries({ ...OPTIONS, conditions: AF });
    const value = (series: typeof v3, day: string, metric: string) =>
      series.find((reading) => reading.day === day && reading.metric === metric)?.value ??
      Number.NaN;
    const episodeDays = v3
      .filter((reading) => reading.metric === "af_burden" && reading.value >= 0.2)
      .map((reading) => reading.day);
    expect(episodeDays.length).toBeGreaterThan(0);
    for (const day of episodeDays) {
      expect(
        value(v3, day, "heart_rate") - value(healthy, day, "heart_rate"),
      ).toBeGreaterThanOrEqual(9);
      expect(value(v3, day, "hrv_rmssd")).toBeGreaterThan(
        value(healthy, day, "hrv_rmssd"),
      );
      expect(value(v3, day, "sleep_score")).toBe(value(healthy, day, "sleep_score"));
    }
  });

  test("sleep apnea lowers nightly SpO2 from onset and is deterministic", () => {
    const options = {
      ...OPTIONS,
      conditions: [{ kind: "sleep_apnea", onset: ONSET, abatement: null }] as const,
    };
    const series = generateSeries(options);
    const mins = (after: boolean) =>
      series
        .filter(
          (reading) => reading.metric === "spo2_min" && reading.day >= ONSET === after,
        )
        .map((reading) => reading.value);
    expect(Math.max(...mins(true))).toBeLessThanOrEqual(88);
    expect(Math.min(...mins(false))).toBeGreaterThanOrEqual(89);
    expect(generateSeries(options)).toEqual(series);
  });
});
