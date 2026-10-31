import { describe, expect, test } from "bun:test";

import { type SubjectCondition } from "../synthetic-wearables/conditions";
import { generateSeries } from "../synthetic-wearables/series";

import {
  generatorOnset,
  MIN_WORN_DAYS,
  otherChangeNear,
  recoveryTable,
  recoveryWindow,
  type Subject,
  type SubjectRow,
  subjectGroups,
  subjectRows,
} from "./wearable-recovery";

const condition = (
  kind: SubjectCondition["kind"],
  onset: string,
  abatement: string | null = null,
): SubjectCondition => ({ kind, onset, abatement });

const subjectWith = (
  group: Subject["group"],
  onset: string,
  conditions: readonly SubjectCondition[],
  ref = "subject-1",
): Subject => {
  const window = recoveryWindow(onset);
  return {
    group,
    onset,
    key: `7:${ref}`,
    conditions,
    series: generateSeries({ seed: 7, subjectRef: ref, ...window, conditions }),
  };
};

describe("recoveryWindow", () => {
  test("90 days before the onset and 90 from it", () => {
    expect(recoveryWindow("2020-03-01")).toEqual({ endDay: "2020-05-29", days: 180 });
  });
});

describe("generatorOnset and otherChangeNear", () => {
  test("earliest onset, the latest for a stroke", () => {
    const list = [condition("stroke", "2018-01-01"), condition("stroke", "2020-01-01")];
    expect(generatorOnset(list, "stroke")).toBe("2020-01-01");
    expect(
      generatorOnset([condition("heart_failure", "2019-01-01")], "stroke"),
    ).toBeNull();
  });

  test("another onset or abatement within 90 days counts, older ones do not", () => {
    const list = [
      condition("atrial_fibrillation", "2020-01-01"),
      condition("sleep_apnea", "2010-01-01"),
    ];
    expect(otherChangeNear(list, "atrial_fibrillation", "2020-01-01")).toBe(false);
    expect(
      otherChangeNear(
        [...list, condition("heart_failure", "2020-02-01")],
        "atrial_fibrillation",
        "2020-01-01",
      ),
    ).toBe(true);
    expect(
      otherChangeNear(
        [condition("sleep_apnea", "2010-01-01", "2019-12-01")],
        "atrial_fibrillation",
        "2020-01-01",
      ),
    ).toBe(true);
  });
});

describe("subjectGroups", () => {
  test("eligible onsets enter their group; hypertension only without the four", () => {
    expect(
      subjectGroups([condition("atrial_fibrillation", "2020-01-01")], "2019-01-01"),
    ).toEqual([{ group: "atrial_fibrillation", onset: "2020-01-01" }]);
    expect(subjectGroups([], "2019-01-01")).toEqual([
      { group: "hypertension", onset: "2019-01-01" },
    ]);
    expect(subjectGroups([condition("stroke", "2010-01-01")], null)).toEqual([]);
    expect(subjectGroups([], "2025-12-01")).toEqual([]);
  });
});

describe("subjectRows", () => {
  test("a stroke's planted steps drop is found early and mostly gone late", () => {
    const rows = subjectRows(
      subjectWith("stroke", "2020-06-01", [condition("stroke", "2020-06-01")]),
    );
    const steps = (window: string) =>
      rows.find((row) => row.metric === "steps" && row.window === window);
    expect(steps("0-29 d")?.planted).toBeCloseTo(0.8 - 0.4 * 0.64, 1);
    expect(steps("60-89 d")?.planted).toBeGreaterThan(0.75);
    expect(steps("0-29 d")?.recovered).toBeLessThan(0.75);
    expect(steps("0-29 d")?.nBefore).toBeGreaterThan(0);
  });

  test("heart failure plants a fixed resting heart rate rise that the series shows", () => {
    const rows = subjectRows(
      subjectWith("heart_failure", "2020-06-01", [
        condition("heart_failure", "2020-06-01"),
      ]),
    );
    const resting = rows.find((row) => row.metric === "resting_heart_rate");
    expect(resting?.planted).toBeGreaterThanOrEqual(5);
    expect(resting?.planted).toBeLessThanOrEqual(10);
    expect(resting?.recovered).toBeGreaterThan(2);
  });

  test("hypertension has nothing planted; drawn baselines only wander", () => {
    const rows = subjectRows(subjectWith("hypertension", "2020-06-01", []));
    expect(rows.length).toBe(10);
    // SpO2 and false notifications are drawn day by day even without a condition.
    const drawn = new Set(["spo2_mean", "spo2_min", "irregular_rhythm_notifications"]);
    for (const row of rows) {
      if (drawn.has(row.metric)) expect(Math.abs(row.planted ?? 9)).toBeLessThan(1);
      else expect(row.planted).toBe(row.kind === "ratio" ? 1 : 0);
    }
  });
});

describe("recoveryTable", () => {
  const row = (recovered: number, nBefore = 50): SubjectRow => ({
    group: "heart_failure",
    metric: "steps",
    window: "0-89 d",
    kind: "ratio",
    planted: 0.65,
    recovered,
    expected: 0.7,
    expectedNoFloor: 0.65,
    z: recovered < 0.8 ? -3 : 0.5,
    nBefore,
    nAfter: 50,
  });

  test("pools subjects with enough worn days", () => {
    const [pooled] = recoveryTable([
      row(0.6),
      row(0.7),
      row(0.9),
      row(0.1, MIN_WORN_DAYS - 1),
    ]);
    expect(pooled?.subjects).toBe(3);
    expect(pooled?.plantedMedian).toBeCloseTo(0.65, 12);
    expect(pooled?.recoveredMedian).toBeCloseTo(0.7, 12);
    expect(pooled?.recoveredQ1).toBeCloseTo(0.65, 12);
    expect(pooled?.recoveredMean).toBeCloseTo(2.2 / 3, 12);
    expect(pooled?.zBeyond2).toBe(2);
    expect(pooled?.withZ).toBe(3);
  });

  test("paired differences from the planted and the expected ratio", () => {
    const [pooled] = recoveryTable([row(0.6), row(0.7), row(0.8)]);
    expect(pooled?.plantedMean).toBeCloseTo(0.65, 12);
    expect(pooled?.expectedMean).toBeCloseTo(0.7, 12);
    expect(pooled?.recoveredMinusPlanted?.mean).toBeCloseTo(0.05, 12);
    expect(pooled?.recoveredMinusExpected?.mean).toBeCloseTo(0, 12);
    expect(pooled?.recoveredMinusExpected?.low).toBeLessThan(0);
    expect(pooled?.recoveredMinusExpected?.high).toBeGreaterThan(0);
  });
});

describe("expected ratios in subject rows", () => {
  test("heart failure RMSSD and steps carry an expected ratio above the planted factor", () => {
    const rows = subjectRows(
      subjectWith("heart_failure", "2020-06-01", [
        condition("heart_failure", "2020-06-01"),
      ]),
    );
    for (const metric of ["hrv_rmssd", "steps"] as const) {
      const found = rows.find((r) => r.metric === metric);
      expect(found?.expected).not.toBeNull();
      expect(found?.expected ?? 0).toBeGreaterThanOrEqual(
        (found?.expectedNoFloor ?? 1) - 1e-9,
      );
    }
    expect(rows.find((r) => r.metric === "resting_heart_rate")?.expected).toBeNull();
  });
});
