/**
 * The resolution study (#290): how well each level of the aggregation ladder
 * tells an AF day from a sinus day of the same simulated people, and an AF
 * hour from an AF-free hour on simulated days and on annotated databases.
 * Pure: the same options give the same result.
 *
 * Every simulated subject has `baselineDays` sinus days (their own baseline),
 * then `sinusDays` sinus days and one AF day per burden for evaluation. A
 * score is used as it is ("absolute") and as its change from the subject's
 * baseline median ("change"), the way a wearable compares a day with the
 * wearer's normal. AUROC compares the AF days of one burden (or all) with
 * the evaluation sinus days; 95 % intervals resample subjects (or records).
 */
import { median } from "@/packages/query-tools/stats";
import { randomFor } from "@/infrastructure/seeded-random";

import { type Perturbation } from "../perturb";
import { auroc, clusterBootstrap, type Estimate } from "../statistics";
import {
  dayFeatures,
  type FeatureId,
  type Features,
  hourFeatures,
  type Interval,
  MS,
  splitUnits,
} from "./aggregate";
import { dayIntervals, simulateDay } from "./day-sim";

export const STUDY_VERSION = 1;

export type NoiseLevel = Readonly<{ id: string } & Perturbation>;

export type StudyOptions = Readonly<{
  subjects: number;
  baselineDays: number;
  sinusDays: number;
  /** AF burdens, share of the day; one AF day per subject for each. */
  burdens: readonly number[];
  noise: readonly NoiseLevel[];
  resamples: number;
  bootstrapSeed: number;
}>;

export const DEFAULT_BURDENS = [0.02, 0.1, 0.3, 0.6] as const;

export const DAY_FEATURES: readonly FeatureId[] = [
  "beat.flag_share",
  "30s.irregular_share",
  "30s.hr_jumps",
  "5min.irregular_share",
  "5min.hr_jumps",
  "1h.irregular_share",
  "1h.hr_jumps",
  "unit.nrmssd",
  "unit.heart_rate",
  "day.resting_heart_rate",
  "day.hrv_rmssd",
];

export const HOUR_FEATURES: readonly FeatureId[] = [
  "beat.flag_share",
  "30s.irregular_share",
  "30s.hr_jumps",
  "5min.irregular_share",
  "5min.hr_jumps",
  "unit.nrmssd",
  "unit.heart_rate",
];

export type DayKind = "baseline" | "sinus" | "af";

export type DayRow = Readonly<{
  subject: string;
  day: number;
  kind: DayKind;
  burden: number;
  /** Share of the day's intervals the simulator labelled AF (after noise). */
  afShare: number;
  noise: string;
  features: Features;
}>;

export type HourRow = Readonly<{
  cluster: string;
  hour: number;
  afShare: number;
  noise: string;
  features: Features;
}>;

export const subjectRef = (index: number): string => `af-resolution-${index}`;

/** The days of one subject, in order: baseline, sinus, then one AF day per burden. */
export const subjectDays = (
  options: Pick<StudyOptions, "baselineDays" | "sinusDays" | "burdens">,
): ReadonlyArray<Readonly<{ day: number; kind: DayKind; burden: number }>> =>
  [
    ...Array.from({ length: options.baselineDays }, () => ({
      kind: "baseline" as const,
      burden: 0,
    })),
    ...Array.from({ length: options.sinusDays }, () => ({
      kind: "sinus" as const,
      burden: 0,
    })),
    ...options.burdens.map((burden) => ({ kind: "af" as const, burden })),
  ].map((each, day) => ({ ...each, day }));

const shareAf = (intervals: readonly Interval[]): number =>
  intervals.length === 0
    ? 0
    : intervals.filter((each) => each.af).length / intervals.length;

/** Units with less than this share of their span covered by intervals are left out. */
export const MIN_UNIT_COVERAGE = 0.5;

/** Hour rows of one stretch of intervals (a day, or a record), timed from its start. */
export const hourRows = (
  cluster: string,
  intervals: readonly Interval[],
  noise: string,
): HourRow[] =>
  [...splitUnits(intervals, MS.hour).entries()]
    .filter(
      ([, unit]) =>
        unit.reduce((total, each) => total + each.rrMs, 0) >= MIN_UNIT_COVERAGE * MS.hour,
    )
    .map(([hour, unit]) => ({
      cluster,
      hour,
      afShare: shareAf(unit),
      noise,
      features: hourFeatures(unit),
    }));

export type SimulatedRows = Readonly<{ days: DayRow[]; hours: HourRow[] }>;

/** Simulates every day once and scores it at each noise level; `onDay` reports progress. */
export const simulateRows = (
  options: StudyOptions,
  onDay: (done: number, total: number) => void = () => {},
): SimulatedRows => {
  const plan = subjectDays(options);
  const total = options.subjects * plan.length;
  const days: DayRow[] = [];
  const hours: HourRow[] = [];
  for (let s = 0; s < options.subjects; s += 1) {
    const subject = subjectRef(s);
    for (const each of plan) {
      const day = simulateDay({
        subjectRef: subject,
        day: each.day,
        burden: each.burden,
      });
      for (const noise of options.noise) {
        const intervals = dayIntervals(day, noise);
        days.push({
          subject,
          day: each.day,
          kind: each.kind,
          burden: each.burden,
          afShare: shareAf(intervals),
          noise: noise.id,
          features: dayFeatures(intervals),
        });
        if (each.kind !== "baseline")
          hours.push(...hourRows(subject, intervals, noise.id));
      }
      onDay(days.length / options.noise.length, total);
    }
  }
  return { days, hours };
};

export type Variant = "absolute" | "change";

const valueOf = (features: Features, feature: FeatureId): number | null =>
  features[feature] ?? null;

/** Each subject's baseline median of a feature, by subject (null without a value). */
export const baselineMedians = (
  rows: readonly DayRow[],
  feature: FeatureId,
): Map<string, number | null> => {
  const values = new Map<string, number[]>();
  for (const row of rows) {
    if (row.kind !== "baseline") continue;
    const value = valueOf(row.features, feature);
    const list = values.get(row.subject) ?? [];
    if (value !== null) list.push(value);
    values.set(row.subject, list);
  }
  return new Map([...values.entries()].map(([subject, list]) => [subject, median(list)]));
};

type Scored = Readonly<{ cluster: string; positive: boolean; score: number }>;

const aurocOf = (rows: readonly Scored[]): number | null =>
  auroc(
    rows.filter((row) => row.positive).map((row) => row.score),
    rows.filter((row) => !row.positive).map((row) => row.score),
  );

const clustered = (rows: readonly Scored[]): Scored[][] => {
  const by = new Map<string, Scored[]>();
  for (const row of rows) by.set(row.cluster, [...(by.get(row.cluster) ?? []), row]);
  return [...by.keys()].sort().map((key) => by.get(key) ?? []);
};

export type AurocCell = Readonly<{
  positives: number;
  negatives: number;
  clusters: number;
  auroc: Estimate;
}>;

/** AUROC with a cluster bootstrap interval, seeded by `key`. */
export const aurocCell = (
  rows: readonly Scored[],
  resamples: number,
  bootstrapSeed: number,
  key: string,
): AurocCell => {
  const clusters = clustered(rows);
  return {
    positives: rows.filter((row) => row.positive).length,
    negatives: rows.filter((row) => !row.positive).length,
    clusters: clusters.length,
    auroc: clusterBootstrap(clusters, aurocOf, resamples, randomFor(bootstrapSeed, key)),
  };
};

export type DayAuroc = AurocCell &
  Readonly<{
    noise: string;
    feature: FeatureId;
    variant: Variant;
    burden: number | "all";
  }>;

/** Scored day rows of one noise level for a feature and variant: AF days of the burden against sinus days. */
export const scoredDays = (
  rows: readonly DayRow[],
  feature: FeatureId,
  variant: Variant,
  burden: number | "all",
): Scored[] => {
  const baseline = baselineMedians(rows, feature);
  return rows.flatMap((row): Scored[] => {
    if (row.kind === "baseline") return [];
    if (row.kind === "af" && burden !== "all" && row.burden !== burden) return [];
    const value = valueOf(row.features, feature);
    if (value === null) return [];
    const reference = variant === "change" ? (baseline.get(row.subject) ?? null) : 0;
    if (reference === null) return [];
    return [
      { cluster: row.subject, positive: row.kind === "af", score: value - reference },
    ];
  });
};

export const dayAurocs = (
  rows: readonly DayRow[],
  options: Pick<StudyOptions, "noise" | "burdens" | "resamples" | "bootstrapSeed">,
): DayAuroc[] =>
  options.noise.flatMap((noise) => {
    const atNoise = rows.filter((row) => row.noise === noise.id);
    return DAY_FEATURES.flatMap((feature) =>
      (["absolute", "change"] as const).flatMap((variant) =>
        [...options.burdens, "all" as const].map((burden) => ({
          noise: noise.id,
          feature,
          variant,
          burden,
          ...aurocCell(
            scoredDays(atNoise, feature, variant, burden),
            options.resamples,
            options.bootstrapSeed,
            `day:${noise.id}:${feature}:${variant}:${burden}`,
          ),
        })),
      ),
    );
  });

/** Hour AF-share bins: AF hours with a share in (low, high] against AF-free hours. */
export const HOUR_BINS = [
  { id: "0-5%", low: 0, high: 0.05 },
  { id: "5-30%", low: 0.05, high: 0.3 },
  { id: "30-70%", low: 0.3, high: 0.7 },
  { id: "70-100%", low: 0.7, high: 1 },
  { id: "any", low: 0, high: 1 },
] as const;

export type HourBin = (typeof HOUR_BINS)[number]["id"];

export type HourAuroc = AurocCell &
  Readonly<{ source: string; noise: string; feature: FeatureId; bin: HourBin }>;

export const scoredHours = (
  rows: readonly HourRow[],
  feature: FeatureId,
  bin: (typeof HOUR_BINS)[number],
): Scored[] =>
  rows.flatMap((row): Scored[] => {
    const value = valueOf(row.features, feature);
    if (value === null) return [];
    if (row.afShare === 0)
      return [{ cluster: row.cluster, positive: false, score: value }];
    if (row.afShare > bin.low && row.afShare <= bin.high)
      return [{ cluster: row.cluster, positive: true, score: value }];
    return [];
  });

export const hourAurocs = (
  source: string,
  rows: readonly HourRow[],
  noiseIds: readonly string[],
  options: Pick<StudyOptions, "resamples" | "bootstrapSeed">,
): HourAuroc[] =>
  noiseIds.flatMap((noise) => {
    const atNoise = rows.filter((row) => row.noise === noise);
    return HOUR_FEATURES.flatMap((feature) =>
      HOUR_BINS.map((bin) => ({
        source,
        noise,
        feature,
        bin: bin.id,
        ...aurocCell(
          scoredHours(atNoise, feature, bin),
          options.resamples,
          options.bootstrapSeed,
          `hour:${source}:${noise}:${feature}:${bin.id}`,
        ),
      })),
    );
  });

export type DailyEffect = Readonly<{
  noise: string;
  burden: number;
  days: number;
  /** Median change from the subject's baseline median, /min. */
  heartRateChange: number | null;
  restingHeartRateChange: number | null;
  /** Median ratio of the night RMSSD to the subject's baseline median. */
  hrvRmssdRatio: number | null;
  /** Median share of the day the simulator labelled AF. */
  afShare: number | null;
}>;

/** How the daily summaries move on AF days (and on sinus days, burden 0), for comparison with v3's assumptions. */
export const dailyEffects = (
  rows: readonly DayRow[],
  options: Pick<StudyOptions, "noise" | "burdens">,
): DailyEffect[] =>
  options.noise.flatMap((noise) => {
    const atNoise = rows.filter((row) => row.noise === noise.id);
    const baseHr = baselineMedians(atNoise, "unit.heart_rate");
    const baseRest = baselineMedians(atNoise, "day.resting_heart_rate");
    const baseHrv = baselineMedians(atNoise, "day.hrv_rmssd");
    const change = (
      list: readonly DayRow[],
      feature: FeatureId,
      base: Map<string, number | null>,
      ratio: boolean,
    ): number | null =>
      median(
        list.flatMap((row) => {
          const value = valueOf(row.features, feature);
          const reference = base.get(row.subject) ?? null;
          if (value === null || reference === null || (ratio && reference === 0))
            return [];
          return [ratio ? value / reference : value - reference];
        }),
      );
    return [0, ...options.burdens].map((burden) => {
      const list = atNoise.filter((row) =>
        burden === 0 ? row.kind === "sinus" : row.kind === "af" && row.burden === burden,
      );
      return {
        noise: noise.id,
        burden,
        days: list.length,
        heartRateChange: change(list, "unit.heart_rate", baseHr, false),
        restingHeartRateChange: change(list, "day.resting_heart_rate", baseRest, false),
        hrvRmssdRatio: change(list, "day.hrv_rmssd", baseHrv, true),
        afShare: median(list.map((row) => row.afShare)),
      };
    });
  });
