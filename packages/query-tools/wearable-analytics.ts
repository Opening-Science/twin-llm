/**
 * What the wearable tools report, built from readings already in hand. Pure:
 * tools.ts picks the sources, reads (the snapshots or the synthetic series)
 * and audits; this does the arithmetic with the maths in stats.ts, so a
 * slope, a median or a ratio is never the model's own.
 *
 * Sources are never pooled. Two devices measure HRV, sleep and workouts in
 * their own ways, and the same run can be recorded by both, so every number
 * belongs to one source and every row names it.
 */
import {
  noWearableRows,
  type NoWearableRows,
  WEARABLE_TREND_MINIMUM,
  wearableMixedUnits,
  type WearableMixedUnits,
  windowTooShort,
  type WindowTooShort,
} from "./refusals";
import {
  type DayWindow,
  mad,
  maximum,
  mean,
  median,
  olsSlopePerDay,
  recentAndBaseline,
  recentLoadRatio,
  robustZ,
  utcDay,
  weekStart,
} from "./stats";
import {
  type DayReading,
  type RowSource,
  SLEEP_FIELD_UNITS,
  SLEEP_FIELDS,
  SLEEP_SOURCES,
  type SleepField,
  type SportGroup,
  sportGroup,
  WORKOUT_FIELD_UNITS,
  type WorkoutField,
  type WorkoutPart,
} from "./wearable-readings";

/** The instants a window covers, from its parsed bounds. */
export type Span = Readonly<{ from: Date; to: Date }>;

const inSpan = (at: Date, span: Span): boolean =>
  at.getTime() >= span.from.getTime() && at.getTime() <= span.to.getTime();

const inDays = (day: string, window: DayWindow): boolean =>
  day >= window.start && day <= window.end;

const distinct = (units: readonly (string | null)[]): string[] =>
  [...new Set(units.map((unit) => unit ?? ""))].sort();

/**
 * MIXED_UNITS when one source's readings of a field use two units, or a unit
 * other than the one the field is named for. `null` when they agree.
 */
const unitsRefusal = (
  measure: string,
  source: RowSource,
  units: readonly (string | null)[],
  expected: string | null,
): WearableMixedUnits | null => {
  const found = distinct(units);
  const wrong = expected !== null && found.some((unit) => unit !== expected);
  return found.length > 1 || wrong ? wearableMixedUnits(measure, source, found) : null;
};

const firstOf = <T>(items: readonly (T | null)[]): T | null =>
  items.find((item): item is T => item !== null) ?? null;

// ─── hrv_trend, resting_hr_trend ────────────────────────────────────────────

export type TrendSourceRow = Readonly<{
  source: RowSource;
  /** The key family (personal) or code (synthetic) the readings come from. */
  key: string;
  unit: string | null;
  /** Daily readings in the window. */
  n: number;
  first_day: string | null;
  last_day: string | null;
  slope_per_day: number | null;
  slope_per_week: number | null;
  slope_unit: string | null;
  slope_per_week_unit: string | null;
  fitted_first: number | null;
  fitted_last: number | null;
  recent: Readonly<{ start: string; end: string; n: number; median: number | null }>;
  baseline: Readonly<{
    start: string;
    end: string;
    n: number;
    median: number | null;
    mad: number | null;
  }>;
  robust_z: number | null;
}>;

export type WearableTrendResult = Readonly<{
  measure: string;
  start: string;
  end: string;
  /** Daily readings in the window, every source together. */
  n: number;
  sources: readonly TrendSourceRow[];
}>;

export type TrendSeries = Readonly<{
  source: RowSource;
  key: string;
  readings: readonly DayReading[];
}>;

const trendRow = (series: TrendSeries, span: Span, endDay: string): TrendSourceRow => {
  const inWindow = series.readings.filter((reading) => inSpan(reading.at, span));
  const enough = inWindow.length >= WEARABLE_TREND_MINIMUM;
  const fit = enough
    ? olsSlopePerDay(
        inWindow.map((reading) => ({ at: reading.at, value: reading.value })),
      )
    : null;
  const { recent, baseline } = recentAndBaseline(endDay);
  const recentValues = series.readings
    .filter((reading) => inDays(reading.day, recent))
    .map((reading) => reading.value);
  const baselineValues = series.readings
    .filter((reading) => inDays(reading.day, baseline))
    .map((reading) => reading.value);
  const unit = series.readings[0]?.unit ?? null;
  return {
    source: series.source,
    key: series.key,
    unit,
    n: inWindow.length,
    first_day: inWindow.at(0)?.day ?? null,
    last_day: inWindow.at(-1)?.day ?? null,
    slope_per_day: fit?.slopePerDay ?? null,
    slope_per_week: fit === null ? null : fit.slopePerDay * 7,
    slope_unit: fit === null || unit === null ? null : `${unit}/d`,
    slope_per_week_unit: fit === null || unit === null ? null : `${unit}/wk`,
    fitted_first: fit?.fittedFirst ?? null,
    fitted_last: fit?.fittedLast ?? null,
    recent: { ...recent, n: recentValues.length, median: median(recentValues) },
    baseline: {
      ...baseline,
      n: baselineValues.length,
      median: median(baselineValues),
      mad: mad(baselineValues),
    },
    robust_z: robustZ(baselineValues, recentValues),
  };
};

/**
 * Per source: the least-squares slope over the window, and the 7 days ending
 * on the window's last day against the 28 days before them. NO_ROWS when no
 * source has a reading in the window; WINDOW_TOO_SHORT when none has 7; a
 * source under 7 keeps its counts and medians but no slope.
 */
export const wearableTrend = (
  measure: string,
  sourceLabel: string,
  window: Readonly<{ start: string; end: string }>,
  span: Span,
  endDay: string,
  series: readonly TrendSeries[],
): WearableTrendResult | NoWearableRows | WearableMixedUnits | WindowTooShort => {
  const { recent, baseline } = recentAndBaseline(endDay);
  const compared = { start: baseline.start, end: recent.end };
  // Only the readings the result uses: the window, and the 35 days it compares.
  const used = series.map((one) => ({
    ...one,
    readings: one.readings.filter(
      (reading) => inSpan(reading.at, span) || inDays(reading.day, compared),
    ),
  }));
  const mixed = firstOf(
    used.map((one) =>
      unitsRefusal(
        measure,
        one.source,
        one.readings.map((reading) => reading.unit),
        null,
      ),
    ),
  );
  if (mixed !== null) return mixed;
  const rows = used.map((one) => trendRow(one, span, endDay));
  const withData = rows.filter((row) => row.n > 0);
  if (withData.length === 0) return noWearableRows(measure, sourceLabel);
  if (withData.every((row) => row.n < WEARABLE_TREND_MINIMUM)) {
    return windowTooShort(
      measure,
      withData.map((row) => ({ source: row.source, n: row.n })),
    );
  }
  return {
    measure,
    start: window.start,
    end: window.end,
    n: rows.reduce((total, row) => total + row.n, 0),
    sources: withData,
  };
};

// ─── sleep_summary ──────────────────────────────────────────────────────────

export type SleepNight = Readonly<{
  source: RowSource;
  day: string;
  duration_min: number | null;
  in_bed_min: number | null;
  efficiency_pct: number | null;
  score: number | null;
}>;

export type SleepSourceRow = Readonly<{
  source: RowSource;
  nights: number;
  score_name: string | null;
  score_unit: string | null;
  mean_duration_min: number | null;
  mean_in_bed_min: number | null;
  mean_efficiency_pct: number | null;
  mean_score: number | null;
}>;

export type SleepSummaryResult = Readonly<{
  start: string;
  end: string;
  /** Readings in the window, every source and field together. */
  n: number;
  sources: readonly SleepSourceRow[];
  nights: readonly SleepNight[];
}>;

export type SleepSeries = Readonly<{
  source: RowSource;
  fields: Readonly<Partial<Record<SleepField, readonly DayReading[]>>>;
}>;

const NIGHT_FIELD: Readonly<
  Record<SleepField, "duration_min" | "in_bed_min" | "efficiency_pct" | "score">
> = {
  duration: "duration_min",
  in_bed: "in_bed_min",
  efficiency: "efficiency_pct",
  score: "score",
};

const fieldValues = (
  nights: readonly SleepNight[],
  field: SleepField,
): readonly number[] =>
  nights.flatMap((night) => {
    const value = night[NIGHT_FIELD[field]];
    return value === null ? [] : [value];
  });

/** One source's nights: a night is a day with at least one of the fields. */
const nightsOf = (series: SleepSeries, span: Span): readonly SleepNight[] => {
  const inWindow = (field: SleepField) =>
    (series.fields[field] ?? []).filter((reading) => inSpan(reading.at, span));
  const days = [
    ...new Set(SLEEP_FIELDS.flatMap((field) => inWindow(field).map((r) => r.day))),
  ].sort();
  const valueOn = (field: SleepField, day: string): number | null =>
    inWindow(field).find((reading) => reading.day === day)?.value ?? null;
  return days.map((day) => ({
    source: series.source,
    day,
    duration_min: valueOn("duration", day),
    in_bed_min: valueOn("in_bed", day),
    efficiency_pct: valueOn("efficiency", day),
    score: valueOn("score", day),
  }));
};

/**
 * Main sleep per night and per-source averages over the nights that have the
 * field. NO_ROWS when no source has a night in the window.
 */
export const sleepSummary = (
  sourceLabel: string,
  window: Readonly<{ start: string; end: string }>,
  span: Span,
  series: readonly SleepSeries[],
): SleepSummaryResult | NoWearableRows | WearableMixedUnits => {
  const mixed = firstOf(
    series.flatMap((one) =>
      SLEEP_FIELDS.map((field) =>
        unitsRefusal(
          `sleep.${field}`,
          one.source,
          (one.fields[field] ?? [])
            .filter((reading) => inSpan(reading.at, span))
            .map((reading) => reading.unit),
          SLEEP_FIELD_UNITS[field],
        ),
      ),
    ),
  );
  if (mixed !== null) return mixed;
  const perSource = series.map((one) => ({ one, nights: nightsOf(one, span) }));
  const nights = perSource.flatMap((entry) => entry.nights);
  if (nights.length === 0) return noWearableRows("sleep", sourceLabel);
  return {
    start: window.start,
    end: window.end,
    n: SLEEP_FIELDS.reduce(
      (total, field) => total + fieldValues(nights, field).length,
      0,
    ),
    sources: perSource
      .filter((entry) => entry.nights.length > 0)
      .map(({ one, nights: own }) => ({
        source: one.source,
        nights: own.length,
        score_name: SLEEP_SOURCES[one.source].scoreName,
        score_unit: one.fields.score?.[0]?.unit ?? null,
        mean_duration_min: mean(fieldValues(own, "duration")),
        mean_in_bed_min: mean(fieldValues(own, "in_bed")),
        mean_efficiency_pct: mean(fieldValues(own, "efficiency")),
        mean_score: mean(fieldValues(own, "score")),
      })),
    nights: [...nights].sort(
      (a, b) =>
        (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) ||
        (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
    ),
  };
};

// ─── training_load ──────────────────────────────────────────────────────────

/** The only words the ratio is given, so no reading of it is implied. */
export const RECENT_LOAD_LABEL = "recent load compared with the previous four weeks";

export type TrainingLoadRow = Readonly<{
  source: RowSource;
  /** The day, or the Monday that starts the week. */
  period_start: string;
  sport: string;
  sport_group: SportGroup;
  sessions: number;
  minutes: number | null;
  /** Whoop strain does not add up across workouts, so a period keeps the highest. */
  max_strain: number | null;
  calories: number | null;
}>;

export type TrainingLoadSourceRow = Readonly<{
  source: RowSource;
  sessions: number;
  minutes: number;
  recent_load: Readonly<{
    label: typeof RECENT_LOAD_LABEL;
    recent: Readonly<{ start: string; end: string; minutes: number }>;
    previous: Readonly<{ start: string; end: string; minutes: number }>;
    ratio: number | null;
  }>;
}>;

export type TrainingLoadResult = Readonly<{
  start: string;
  end: string;
  aggregation: "day" | "week";
  sport: SportGroup | null;
  /** Workout values read in the window, every source together. */
  n: number;
  periods: readonly TrainingLoadRow[];
  sources: readonly TrainingLoadSourceRow[];
}>;

/** How many workouts some parts describe: per day and session, the most values of one field. */
const sessionsIn = (parts: readonly WorkoutPart[]): number => {
  const groups = Map.groupBy(parts, (part) => `${part.day}|${part.session}`);
  return [...groups.values()].reduce((total, group) => {
    const perField = Map.groupBy(group, (part) => part.field);
    return total + Math.max(...[...perField.values()].map((items) => items.length));
  }, 0);
};

const sumOf = (parts: readonly WorkoutPart[], field: WorkoutField): number | null => {
  const values = parts.filter((part) => part.field === field).map((part) => part.value);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
};

const minutesIn = (parts: readonly WorkoutPart[], window: DayWindow): number =>
  sumOf(
    parts.filter((part) => inDays(part.day, window)),
    "minutes",
  ) ?? 0;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Workouts per period and sport, and per source the minutes in the 7 days
 * ending on `endDay` against the 28 days before them. NO_ROWS when the window
 * holds no workout from the requested sources (after the sport filter).
 */
export const trainingLoad = (
  sourceLabel: string,
  input: Readonly<{
    start: string;
    end: string;
    aggregation: "day" | "week";
    sport?: SportGroup;
  }>,
  span: Span,
  endDay: string,
  sources: ReadonlyArray<Readonly<{ source: RowSource; parts: readonly WorkoutPart[] }>>,
): TrainingLoadResult | NoWearableRows | WearableMixedUnits => {
  // A workout is a day's record, so the window counts whole UTC days.
  const days = { start: utcDay(span.from), end: utcDay(span.to) };
  const { recent, baseline } = recentAndBaseline(endDay);
  const compared = { start: baseline.start, end: recent.end };
  const kept = sources.map((entry) => ({
    source: entry.source,
    parts: entry.parts.filter(
      (part) =>
        (input.sport === undefined || sportGroup(part.sport) === input.sport) &&
        (inDays(part.day, days) || inDays(part.day, compared)),
    ),
  }));
  const fields: readonly WorkoutField[] = ["minutes", "strain", "calories"];
  const mixed = firstOf(
    kept.flatMap((entry) =>
      fields.map((field) =>
        unitsRefusal(
          `workout.${field}`,
          entry.source,
          entry.parts.filter((part) => part.field === field).map((part) => part.unit),
          WORKOUT_FIELD_UNITS[field],
        ),
      ),
    ),
  );
  if (mixed !== null) return mixed;
  const inWindow = kept.map((entry) => ({
    source: entry.source,
    all: entry.parts,
    parts: entry.parts.filter((part) => inDays(part.day, days)),
  }));
  const n = inWindow.reduce((total, entry) => total + entry.parts.length, 0);
  if (n === 0) return noWearableRows("workouts", sourceLabel);
  const period = (day: string): string =>
    input.aggregation === "week" ? weekStart(day) : day;
  const rows = inWindow
    .flatMap((entry) =>
      [
        ...Map.groupBy(
          entry.parts,
          (part) => `${period(part.day)}|${part.sport}`,
        ).values(),
      ].map((group): TrainingLoadRow => {
        const first = group[0]!;
        const strain = group
          .filter((part) => part.field === "strain")
          .map((part) => part.value);
        return {
          source: entry.source,
          period_start: period(first.day),
          sport: first.sport,
          sport_group: sportGroup(first.sport),
          sessions: sessionsIn(group),
          minutes: sumOf(group, "minutes"),
          max_strain: maximum(strain),
          calories: sumOf(group, "calories"),
        };
      }),
    )
    .sort(
      (a, b) =>
        compareText(a.period_start, b.period_start) ||
        compareText(a.source, b.source) ||
        compareText(a.sport, b.sport),
    );
  return {
    start: input.start,
    end: input.end,
    aggregation: input.aggregation,
    sport: input.sport ?? null,
    n,
    periods: rows,
    sources: inWindow
      .filter((entry) => entry.parts.length > 0)
      .map((entry) => {
        const recentMinutes = minutesIn(entry.all, recent);
        const previousMinutes = minutesIn(entry.all, baseline);
        return {
          source: entry.source,
          sessions: sessionsIn(entry.parts),
          minutes: sumOf(entry.parts, "minutes") ?? 0,
          recent_load: {
            label: RECENT_LOAD_LABEL,
            recent: { ...recent, minutes: recentMinutes },
            previous: { ...baseline, minutes: previousMinutes },
            ratio: recentLoadRatio(recentMinutes, previousMinutes),
          },
        };
      }),
  };
};
