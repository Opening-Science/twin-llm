/**
 * Does an analysis of the synthetic wearable series find the changes that
 * generator v3 planted around a condition's onset? Pure.
 *
 * For each subject the series covers 90 days before the onset and 90 days
 * from it (`recoveryWindow`). The planted change is read from the
 * generator's own `conditionEffects` over every day of each window; the
 * recovered change is read from the worn days of the noisy series with the
 * query tools' statistics (`summariseWindow`, `robustZ`). A delta metric
 * compares means (after minus before), a ratio metric divides them.
 * Hypertension, which has no wearable effect, is the negative control.
 */
import {
  addDays,
  median,
  robustZ,
  summariseWindow,
} from "../../packages/query-tools/stats";
import {
  type ConditionKind,
  conditionEffects,
  type DayEffects,
  type SubjectCondition,
} from "../synthetic-wearables/conditions";
import { type DailyReading } from "../synthetic-wearables/series";

import { type ExpectedMetric, expectedRatio } from "./wearable-expected";

export type Group = ConditionKind | "hypertension";

export type MetricName = DailyReading["metric"];

export type Check = Readonly<{
  metric: MetricName;
  kind: "delta" | "ratio";
  /** The generator's planted value of this metric's modifier on a day. */
  planted: (effects: DayEffects) => number;
}>;

export type AfterWindow = Readonly<{ label: string; from: number; to: number }>;

export const DAYS_AROUND = 90;
export const BEFORE_WINDOW = { label: "before", from: -DAYS_AROUND, to: -1 } as const;
export const AFTER_WINDOWS: Readonly<Record<"all" | "early" | "late", AfterWindow>> = {
  all: { label: "0-89 d", from: 0, to: DAYS_AROUND - 1 },
  early: { label: "0-29 d", from: 0, to: 29 },
  late: { label: "60-89 d", from: 60, to: DAYS_AROUND - 1 },
};

const CHECKS = {
  heartRate: {
    metric: "heart_rate",
    kind: "delta",
    planted: (e) => e.restingHrDelta + e.heartRateDelta,
  },
  restingHeartRate: {
    metric: "resting_heart_rate",
    kind: "delta",
    planted: (e) => e.restingHrDelta,
  },
  rmssd: {
    metric: "hrv_rmssd",
    kind: "ratio",
    planted: (e) => e.hrvFactor * e.irregularHrvFactor,
  },
  steps: { metric: "steps", kind: "ratio", planted: (e) => e.stepsFactor },
  sleepScore: { metric: "sleep_score", kind: "delta", planted: (e) => e.sleepScoreDelta },
  respiration: {
    metric: "respiratory_rate",
    kind: "delta",
    planted: (e) => e.respirationDelta,
  },
  spo2Mean: { metric: "spo2_mean", kind: "delta", planted: (e) => e.spo2?.mean ?? 0 },
  spo2Min: { metric: "spo2_min", kind: "delta", planted: (e) => e.spo2?.min ?? 0 },
  notifications: {
    metric: "irregular_rhythm_notifications",
    kind: "delta",
    planted: (e) => e.irregularRhythmNotifications ?? 0,
  },
  afBurden: { metric: "af_burden", kind: "delta", planted: (e) => e.afBurden ?? 0 },
} satisfies Record<string, Check>;

const ALL_CHECKS: readonly Check[] = Object.values(CHECKS);

/** What is tested for each group, and over which after windows. */
export const PLAN: Readonly<
  Record<Group, Readonly<{ checks: readonly Check[]; windows: readonly AfterWindow[] }>>
> = {
  atrial_fibrillation: {
    checks: [CHECKS.heartRate, CHECKS.rmssd, CHECKS.notifications, CHECKS.afBurden],
    windows: [AFTER_WINDOWS.all],
  },
  heart_failure: {
    checks: [CHECKS.restingHeartRate, CHECKS.rmssd, CHECKS.steps],
    windows: [AFTER_WINDOWS.all],
  },
  stroke: {
    checks: [CHECKS.steps, CHECKS.sleepScore],
    windows: [AFTER_WINDOWS.early, AFTER_WINDOWS.late],
  },
  sleep_apnea: {
    checks: [CHECKS.spo2Mean, CHECKS.spo2Min, CHECKS.respiration],
    windows: [AFTER_WINDOWS.all],
  },
  hypertension: { checks: ALL_CHECKS, windows: [AFTER_WINDOWS.all] },
};

/** The series window that holds 90 days on each side of the onset. */
export const recoveryWindow = (
  onset: string,
): Readonly<{ endDay: string; days: number }> => ({
  endDay: addDays(onset, DAYS_AROUND - 1),
  days: 2 * DAYS_AROUND,
});

const daysOf = (
  onset: string,
  window: Readonly<{ from: number; to: number }>,
): string[] =>
  Array.from({ length: window.to - window.from + 1 }, (_, i) =>
    addDays(onset, window.from + i),
  );

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((t, v) => t + v, 0) / values.length;

const change = (
  kind: Check["kind"],
  before: number | null,
  after: number | null,
): number | null => {
  if (before === null || after === null) return null;
  if (kind === "delta") return after - before;
  return before === 0 ? null : after / before;
};

export type SubjectRow = Readonly<{
  group: Group;
  metric: MetricName;
  window: string;
  kind: Check["kind"];
  planted: number | null;
  recovered: number | null;
  /**
   * RMSSD and steps only: the ratio of expected worn-day means with the
   * generator's floors (`wearable-expected.ts`), and without them.
   */
  expected: number | null;
  expectedNoFloor: number | null;
  /** Robust z of the after window against the before one; null when the baseline MAD is 0. */
  z: number | null;
  nBefore: number;
  nAfter: number;
}>;

export type Subject = Readonly<{
  group: Group;
  onset: string;
  /** `${seed}:${subjectRef}`, as the generator keys its draws. */
  key: string;
  conditions: readonly SubjectCondition[];
  series: readonly DailyReading[];
}>;

/** One row per check and after window for one subject. */
export const subjectRows = (subject: Subject): SubjectRow[] => {
  const plan = PLAN[subject.group];
  const effectsOn = new Map<string, DayEffects>();
  const effects = (day: string): DayEffects => {
    const known = effectsOn.get(day);
    if (known !== undefined) return known;
    const computed = conditionEffects(subject.conditions, day, subject.key);
    effectsOn.set(day, computed);
    return computed;
  };
  const beforeDays = daysOf(subject.onset, BEFORE_WINDOW);
  return plan.checks.flatMap((check) => {
    const worn = (days: readonly string[]) => {
      const wanted = new Set(days);
      return subject.series.filter(
        (reading) => reading.metric === check.metric && wanted.has(reading.day),
      );
    };
    const values = (days: readonly string[]): number[] =>
      worn(days).map((reading) => reading.value);
    const expectedMetric: ExpectedMetric | null =
      check.metric === "hrv_rmssd" || check.metric === "steps" ? check.metric : null;
    const before = values(beforeDays);
    const plantedBefore = average(beforeDays.map((day) => check.planted(effects(day))));
    return plan.windows.map((window) => {
      const afterDays = daysOf(subject.onset, window);
      const after = values(afterDays);
      const expectedOf = (floors: boolean) =>
        expectedMetric === null
          ? null
          : expectedRatio(
              expectedMetric,
              subject.key,
              subject.conditions,
              worn(beforeDays).map((reading) => reading.day),
              worn(afterDays).map((reading) => reading.day),
              floors,
            );
      const summary = (days: readonly string[], v: readonly number[]) =>
        summariseWindow({ start: days[0] ?? "", end: days.at(-1) ?? "" }, v);
      return {
        group: subject.group,
        metric: check.metric,
        window: window.label,
        kind: check.kind,
        planted: change(
          check.kind,
          plantedBefore,
          average(afterDays.map((day) => check.planted(effects(day)))),
        ),
        recovered: change(
          check.kind,
          summary(beforeDays, before).mean,
          summary(afterDays, after).mean,
        ),
        expected: expectedOf(true),
        expectedNoFloor: expectedOf(false),
        z: robustZ(before, after),
        nBefore: before.length,
        nAfter: after.length,
      };
    });
  });
};

export type RecoveryRow = Readonly<{
  group: Group;
  metric: MetricName;
  window: string;
  kind: Check["kind"];
  subjects: number;
  plantedMedian: number | null;
  recoveredMedian: number | null;
  recoveredQ1: number | null;
  recoveredQ3: number | null;
  /** Mean recovered change with a normal 95% interval over subjects. */
  recoveredMean: number | null;
  recoveredCi: Readonly<{ low: number; high: number }> | null;
  plantedMean: number | null;
  /** RMSSD and steps: mean expected ratio with and without the generator's floors. */
  expectedMean: number | null;
  expectedNoFloorMean: number | null;
  /** Per subject, recovered minus planted (and minus expected), mean with a 95% interval. */
  recoveredMinusPlanted: MeanCi | null;
  recoveredMinusExpected: MeanCi | null;
  /** Subjects whose robust z is beyond 2 (either way), out of those with a z. */
  zBeyond2: number;
  withZ: number;
}>;

export type MeanCi = Readonly<{ mean: number; low: number; high: number }>;

/** Mean with a normal 95% interval; null with fewer than 2 values. */
export const meanCi = (values: readonly number[]): MeanCi | null => {
  if (values.length < 2) return null;
  const mean = values.reduce((t, v) => t + v, 0) / values.length;
  const sd = Math.sqrt(
    values.reduce((t, v) => t + (v - mean) ** 2, 0) / (values.length - 1),
  );
  const half = (1.959964 * sd) / Math.sqrt(values.length);
  return { mean, low: mean - half, high: mean + half };
};

const pairedDifference = (
  rows: readonly SubjectRow[],
  reference: (row: SubjectRow) => number | null,
): MeanCi | null =>
  meanCi(
    rows.flatMap((row) => {
      const ref = reference(row);
      return row.recovered === null || ref === null ? [] : [row.recovered - ref];
    }),
  );

/** Subjects need this many worn days on each side to count. */
export const MIN_WORN_DAYS = 10;

const quantile = (sorted: readonly number[], q: number): number | null => {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (
    (sorted[low] as number) +
    ((sorted[high] as number) - (sorted[low] as number)) * (position - low)
  );
};

/** Pools subject rows by group, metric and window. */
export const recoveryTable = (rows: readonly SubjectRow[]): RecoveryRow[] => {
  const groups = new Map<string, SubjectRow[]>();
  for (const row of rows) {
    if (row.nBefore < MIN_WORN_DAYS || row.nAfter < MIN_WORN_DAYS) continue;
    const key = `${row.group}|${row.metric}|${row.window}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as SubjectRow;
    const recovered = group
      .map((row) => row.recovered)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const mean = average(recovered);
    const sd =
      mean === null || recovered.length < 2
        ? null
        : Math.sqrt(
            recovered.reduce((t, v) => t + (v - mean) ** 2, 0) / (recovered.length - 1),
          );
    const zs = group.map((row) => row.z).filter((z): z is number => z !== null);
    return {
      group: first.group,
      metric: first.metric,
      window: first.window,
      kind: first.kind,
      subjects: group.length,
      plantedMedian: median(
        group.map((row) => row.planted).filter((v): v is number => v !== null),
      ),
      recoveredMedian: quantile(recovered, 0.5),
      recoveredQ1: quantile(recovered, 0.25),
      recoveredQ3: quantile(recovered, 0.75),
      recoveredMean: mean,
      recoveredCi:
        mean === null || sd === null
          ? null
          : {
              low: mean - (1.959964 * sd) / Math.sqrt(recovered.length),
              high: mean + (1.959964 * sd) / Math.sqrt(recovered.length),
            },
      plantedMean: average(
        group.map((row) => row.planted).filter((v): v is number => v !== null),
      ),
      expectedMean: average(
        group.map((row) => row.expected).filter((v): v is number => v !== null),
      ),
      expectedNoFloorMean: average(
        group.map((row) => row.expectedNoFloor).filter((v): v is number => v !== null),
      ),
      recoveredMinusPlanted: pairedDifference(group, (row) => row.planted),
      recoveredMinusExpected: pairedDifference(group, (row) => row.expected),
      zBeyond2: zs.filter((z) => Math.abs(z) > 2).length,
      withZ: zs.length,
    };
  });
};

export type Eligibility = Readonly<{ from: string; to: string }>;

/** Onsets from 2016-04-01 (90 days inside the complete window) to 90 days before the records end. */
export const ELIGIBLE_ONSETS: Eligibility = { from: "2016-04-01", to: "2025-10-02" };

/**
 * The onset the generator keys on for a kind (earliest; the latest for a
 * stroke, as `conditionEffects` does), or null.
 */
export const generatorOnset = (
  conditions: readonly SubjectCondition[],
  kind: ConditionKind,
): string | null => {
  const onsets = conditions
    .filter((condition) => condition.kind === kind)
    .map((condition) => condition.onset)
    .sort();
  return (kind === "stroke" ? onsets.at(-1) : onsets[0]) ?? null;
};

/**
 * Whether another condition with an effect starts or stops within 90 days
 * of this onset, which would mix two changes in one comparison.
 */
export const otherChangeNear = (
  conditions: readonly SubjectCondition[],
  kind: ConditionKind | null,
  onset: string,
): boolean => {
  const from = addDays(onset, -DAYS_AROUND);
  const to = addDays(onset, DAYS_AROUND - 1);
  return conditions
    .filter((condition) => condition.kind !== kind)
    .some(
      (condition) =>
        (condition.onset >= from && condition.onset <= to) ||
        (condition.kind !== "stroke" &&
          condition.abatement !== null &&
          condition.abatement >= from &&
          condition.abatement <= to),
    );
};

/** The groups a living subject enters, each with its onset. */
export const subjectGroups = (
  conditions: readonly SubjectCondition[],
  hypertensionOnset: string | null,
  eligible: Eligibility = ELIGIBLE_ONSETS,
): ReadonlyArray<Readonly<{ group: Group; onset: string }>> => {
  const inRange = (day: string | null): day is string =>
    day !== null && day >= eligible.from && day <= eligible.to;
  const kinds: ConditionKind[] = [
    "atrial_fibrillation",
    "heart_failure",
    "stroke",
    "sleep_apnea",
  ];
  const found = kinds.flatMap((kind) => {
    const onset = generatorOnset(conditions, kind);
    return inRange(onset) && !otherChangeNear(conditions, kind, onset)
      ? [{ group: kind as Group, onset }]
      : [];
  });
  // The control: hypertension and none of the four conditions at any time.
  return conditions.length === 0 && inRange(hypertensionOnset)
    ? [...found, { group: "hypertension", onset: hypertensionOnset }]
    : found;
};
