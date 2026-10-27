/**
 * The readings the wearable tools (`sleep_summary`, `hrv_trend`,
 * `resting_hr_trend`, `training_load`) read, from either data path, in one
 * shape: a source, a UTC day and a value with its unit.
 *
 * - Personal mode: the snapshots the turn already loaded, the same metrics
 *   `show_view` draws. A measure is a key family (the key without its date,
 *   `keyFamily`), one reading per family and day, the last one stored, as the
 *   charts do. Oura's main sleep is its `long_sleep` segment (#85).
 * - Synthetic mode: the subject's synthetic series in the warehouse
 *   (`scripts/synthetic-wearables`), read by code. It belongs to no vendor,
 *   so its rows are source `synthetic`.
 *
 * Pure: the tools in tools.ts do the reads and the audit.
 */
import type { WearableSummaries } from "@/infrastructure/offered-keys";
import { keyFamily } from "@/infrastructure/prompt-key-selection";

import type { ObservationRecord } from "./ports";
import type { SPORT_GROUPS } from "./schemas";
import { utcDay } from "./stats";

export const WEARABLE_SOURCES = ["oura", "whoop", "google"] as const;

export type WearableSource = (typeof WEARABLE_SOURCES)[number];

/** A row's source: a linked vendor, or the synthetic series of a synthetic subject. */
export type RowSource = WearableSource | "synthetic";

export type DayReading = Readonly<{
  source: RowSource;
  /** The UTC day; a snapshot reading counts from that day's midnight, as on the charts. */
  day: string;
  at: Date;
  value: number;
  unit: string | null;
}>;

/** No snapshots: synthetic mode, the MCP server and the answer key. */
export const NO_WEARABLE_SNAPSHOTS: WearableSummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

type Metric = Readonly<{ key: string; value: unknown; date?: string; unit?: string }>;

const metricsOf = (
  wearables: WearableSummaries,
  source: WearableSource,
): readonly Metric[] | null => {
  switch (source) {
    case "oura":
      return wearables.oura?.metrics ?? null;
    case "whoop":
      return wearables.whoop?.metrics ?? null;
    case "google":
      return wearables.googleHealth?.metrics ?? null;
  }
};

/** The vendors this turn has a snapshot of, in a fixed order. */
export const linkedSources = (wearables: WearableSummaries): readonly WearableSource[] =>
  WEARABLE_SOURCES.filter((source) => metricsOf(wearables, source) !== null);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const byDay = <T extends Readonly<{ day: string }>>(a: T, b: T): number =>
  a.day < b.day ? -1 : a.day > b.day ? 1 : 0;

/** One reading per day of one key family from one snapshot, oldest first. */
export const snapshotReadings = (
  wearables: WearableSummaries,
  source: WearableSource,
  family: string | undefined,
): readonly DayReading[] => {
  if (family === undefined) return [];
  const perDay = new Map(
    (metricsOf(wearables, source) ?? []).flatMap((metric) =>
      keyFamily(metric.key) === family && isNumber(metric.value) && metric.date
        ? [
            [
              metric.date,
              {
                source,
                day: metric.date,
                at: new Date(`${metric.date}T00:00:00.000Z`),
                value: metric.value,
                unit: metric.unit ?? null,
              },
            ] as const,
          ]
        : [],
    ),
  );
  return [...perDay.values()].sort(byDay);
};

/** One code's rows of the synthetic series, oldest first, one per UTC day (the last). */
export const syntheticReadings = (
  rows: readonly ObservationRecord[],
  code: string,
): readonly DayReading[] => {
  const perDay = new Map(
    rows
      .filter((row) => row.loinc === code)
      .map(
        (row) =>
          [
            utcDay(row.effectiveAt),
            {
              source: "synthetic" as const,
              day: utcDay(row.effectiveAt),
              at: row.effectiveAt,
              value: row.value,
              unit: row.unitUcum,
            },
          ] as const,
      ),
  );
  return [...perDay.values()].sort(byDay);
};

export type TrendMeasure = "hrv" | "resting_hr";

/**
 * Where each trend measure lives. A vendor without a family here records no
 * such measure in its summary: Oura has no resting heart rate key, and the
 * Google Health summary holds no HRV (its HRV and sleep are FHIR components).
 */
export const TREND_MEASURES: Readonly<
  Record<
    TrendMeasure,
    Readonly<{ snapshot: Partial<Record<WearableSource, string>>; synthetic: string }>
  >
> = {
  hrv: {
    snapshot: { oura: "sleep.hrv.long_sleep", whoop: "whoop.recovery.hrv" },
    synthetic: "hrv-rmssd",
  },
  resting_hr: {
    snapshot: { whoop: "whoop.recovery.rhr", google: "google.daily-resting-heart-rate" },
    synthetic: "40443-4",
  },
};

export type SleepField = "duration" | "in_bed" | "efficiency" | "score";

export const SLEEP_FIELDS: readonly SleepField[] = [
  "duration",
  "in_bed",
  "efficiency",
  "score",
];

/** The unit a sleep field is named for; any other is refused, never converted. */
export const SLEEP_FIELD_UNITS: Readonly<Record<SleepField, string | null>> = {
  duration: "min",
  in_bed: "min",
  efficiency: "%",
  score: null,
};

type SleepSource = Readonly<{
  fields: Partial<Record<SleepField, string>>;
  scoreName: string | null;
}>;

/** Each source's main sleep per night. Whoop's summary leaves naps out and has time in bed, not time asleep. */
export const SLEEP_SOURCES: Readonly<Record<RowSource, SleepSource>> = {
  oura: {
    fields: {
      duration: "sleep.duration.long_sleep",
      efficiency: "sleep.efficiency.long_sleep",
      score: "sleep.score.long_sleep",
    },
    scoreName: "Oura sleep score",
  },
  whoop: {
    fields: {
      in_bed: "whoop.sleep.in_bed_min",
      efficiency: "whoop.sleep.efficiency",
      score: "whoop.sleep.performance",
    },
    scoreName: "Whoop sleep performance",
  },
  google: { fields: {}, scoreName: null },
  synthetic: {
    fields: { duration: "93832-4", score: "sleep-score" },
    scoreName: "synthetic sleep score",
  },
};

/** The synthetic series' codes a tool reads for the sleep fields. */
export const SYNTHETIC_SLEEP_CODES: readonly string[] = Object.values(
  SLEEP_SOURCES.synthetic.fields,
);

export type SportGroup = (typeof SPORT_GROUPS)[number];

const SPORT_RULES: ReadonlyArray<Readonly<{ group: SportGroup; pattern: RegExp }>> = [
  { group: "running", pattern: /run|jog|treadmill/ },
  { group: "cycling", pattern: /cycl|bik|spin/ },
  { group: "walking", pattern: /walk|hik/ },
  { group: "swimming", pattern: /swim/ },
  { group: "strength", pattern: /strength|weight|lift|functional|crossfit|resistance/ },
];

/** The sport group of a vendor's sport name; anything unmatched is `other`. */
export const sportGroup = (sport: string): SportGroup =>
  SPORT_RULES.find((rule) => rule.pattern.test(sport.toLowerCase()))?.group ?? "other";

export type WorkoutField = "minutes" | "strain" | "calories";

/** The unit a workout field is named for; any other is refused. Strain has none. */
export const WORKOUT_FIELD_UNITS: Readonly<Record<WorkoutField, string | null>> = {
  minutes: "min",
  strain: null,
  calories: "kcal",
};

/** One recorded value of one workout. `session` tells two workouts of a sport on a day apart. */
export type WorkoutPart = Readonly<{
  source: RowSource;
  day: string;
  sport: string;
  session: string;
  field: WorkoutField;
  value: number;
  unit: string | null;
}>;

/** Snapshot key fields, per vendor: `workout.duration.walking.<day>`, `whoop.workout.strain.running_2.<day>`. */
const WORKOUT_KEYS: Readonly<
  Record<
    WearableSource,
    Readonly<{
      prefix: readonly string[];
      fields: Readonly<Record<string, WorkoutField>>;
    }>
  >
> = {
  oura: { prefix: ["workout"], fields: { duration: "minutes", calories: "calories" } },
  whoop: {
    prefix: ["whoop", "workout"],
    fields: { duration: "minutes", strain: "strain" },
  },
  google: { prefix: ["google", "workout"], fields: {} },
};

/** A second workout of a sport on one day is keyed `<sport>_2` (Whoop). */
const sportName = (session: string): string => session.replace(/_\d+$/, "");

/** Every workout value of one snapshot, in the summary's order. */
export const snapshotWorkouts = (
  wearables: WearableSummaries,
  source: WearableSource,
): readonly WorkoutPart[] => {
  const { prefix, fields } = WORKOUT_KEYS[source];
  return (metricsOf(wearables, source) ?? []).flatMap((metric) => {
    const parts = metric.key.split(".");
    const head = parts.slice(0, prefix.length);
    const [fieldName, session, day, ...rest] = parts.slice(prefix.length);
    const field = fieldName === undefined ? undefined : fields[fieldName];
    return head.every((part, index) => part === prefix[index]) &&
      field !== undefined &&
      session !== undefined &&
      day !== undefined &&
      rest.length === 0 &&
      day === metric.date &&
      isNumber(metric.value)
      ? [
          {
            source,
            day,
            sport: sportName(session),
            session,
            field,
            value: metric.value,
            unit: metric.unit ?? null,
          },
        ]
      : [];
  });
};

/** The synthetic series writes one workout a day at most, as minutes under `workout-<sport>`. */
export const SYNTHETIC_WORKOUT_PREFIX = "workout-";

export const SYNTHETIC_WORKOUT_CODES: readonly string[] = [
  "workout-running",
  "workout-cycling",
  "workout-walking",
  "workout-strength",
];

export const syntheticWorkouts = (
  rows: readonly ObservationRecord[],
): readonly WorkoutPart[] =>
  rows
    .filter((row) => SYNTHETIC_WORKOUT_CODES.includes(row.loinc))
    .map((row) => {
      const sport = row.loinc.slice(SYNTHETIC_WORKOUT_PREFIX.length);
      return {
        source: "synthetic",
        day: utcDay(row.effectiveAt),
        sport,
        session: sport,
        field: "minutes",
        value: row.value,
        unit: row.unitUcum,
      };
    });
