import "server-only";

import { database } from "@/infrastructure/database";

import {
  type ClinicalQuery,
  defaultQueryToolPorts,
  findConditionsInDatabase,
  findMedicationRequestsInDatabase,
  type ObservationRecord,
  type QueryToolPorts,
  toNumber,
} from "./ports";
import {
  ANALYTICS_ROW_CAP,
  COHORT_MINIMUM,
  COHORT_ROW_CAP,
  COHORT_ROW_CAP_EXCEEDED,
  cohortTooSmall,
  isToolRefusal,
  mixedUnits,
  type MixedUnits,
  ROW_CAP_EXCEEDED,
  type ToolRefusal,
  noRecords,
  noRows,
  recordCapExceeded,
  sourceNotConnected,
  type SourceNotConnected,
  unsupportedConversion,
  type UnsupportedConversion,
} from "./refusals";
import {
  cohortInScope,
  SUBJECT_SCOPE_VIOLATION,
  subjectRowInScope,
  type SessionScope,
  type SubjectScopeViolation,
} from "./scope";
import type {
  baselineDeviationInput,
  compareWindowsInput,
  coverageInput,
  latestByLoincInput,
  listSubjectsInput,
  observationsForSubjectInput,
  subjectWindowInput,
  summaryStatsInput,
  trendInput,
  rangePositionInput,
  convertUnitInput,
  cohortPositionInput,
  conditionsTimelineInput,
  medicationsTimelineInput,
  sleepSummaryInput,
  hrvTrendInput,
  restingHrTrendInput,
  trainingLoadInput,
  WEARABLE_SOURCE_CHOICES,
} from "./schemas";
import { windowEndDate, windowStartDate } from "./schemas";
import {
  coverage,
  daysInWindow,
  mad,
  median,
  olsSlopePerDay,
  recentAndBaseline,
  robustZ,
  pickReading,
  summariseWindow,
  type WindowSummary,
  latestPerSubject,
  midRankPercentile,
  utcDay,
} from "./stats";
import { placeReading, type RangePlacement, rangeRefusalFor } from "./range-position";
import { applyConversion, findConversion, supportedPairs } from "./unit-conversions";
import {
  sleepSummary,
  type SleepSummaryResult,
  type Span,
  trainingLoad,
  type TrainingLoadResult,
  wearableTrend,
  type WearableTrendResult,
} from "./wearable-analytics";
import {
  linkedSources,
  NO_WEARABLE_SNAPSHOTS,
  SLEEP_SOURCES,
  snapshotReadings,
  snapshotWorkouts,
  SYNTHETIC_SLEEP_CODES,
  SYNTHETIC_WORKOUT_CODES,
  syntheticReadings,
  syntheticWorkouts,
  TREND_MEASURES,
  type TrendMeasure,
  type WearableSource,
} from "./wearable-readings";
import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { z } from "zod";
import {
  CLINICAL_ROW_CAP,
  conditionsTimeline,
  type ConditionsTimeline,
  medicationsTimeline,
  type MedicationsTimeline,
} from "./clinical-timeline";

type ListSubjectsInput = z.infer<typeof listSubjectsInput>;
type SubjectWindowInput = z.infer<typeof subjectWindowInput>;
type ObservationsInput = z.infer<typeof observationsForSubjectInput>;
type LatestByLoincInput = z.infer<typeof latestByLoincInput>;
type SummaryStatsInput = z.infer<typeof summaryStatsInput>;
type TrendInput = z.infer<typeof trendInput>;
type BaselineDeviationInput = z.infer<typeof baselineDeviationInput>;
type CoverageInput = z.infer<typeof coverageInput>;
type CompareWindowsInput = z.infer<typeof compareWindowsInput>;

export type ObservationRow = {
  readonly subject_ref: string;
  readonly loinc: string;
  readonly display: string;
  readonly value: number;
  readonly unit_ucum: string;
  readonly effective_at: string;
};

const asIso = (value: Date): string => value.toISOString();

const mapRow = (row: {
  subjectRef: string;
  loinc: string;
  display: string;
  value: unknown;
  unitUcum: string;
  effectiveAt: Date;
}): ObservationRow => ({
  subject_ref: row.subjectRef,
  loinc: row.loinc,
  display: row.display,
  value: toNumber(row.value),
  unit_ucum: row.unitUcum,
  effective_at: asIso(row.effectiveAt),
});

/** Audit `result` for a call that threw: a fixed name, never the error message. */
export const QUERY_TOOL_FAILED = { error: "query-tool-failed" } as const;

const audited = async <T>(
  scope: SessionScope,
  tool: string,
  args: unknown,
  subjectRef: string | null,
  work: () => Promise<T>,
  rowCountOf: (result: T) => number,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<T> => {
  // A call that throws (database down, a bad decimal) still happened, so it
  // gets an audit row with 0 rows before the error goes back to the caller.
  const result = await work().catch(async (error: unknown) => {
    await ports.appendAudit({
      actor: scope.actor,
      sessionId: scope.sessionId,
      subjectRef,
      tool,
      args,
      result: QUERY_TOOL_FAILED,
      rowCount: 0,
    });
    throw error;
  });
  await ports.appendAudit({
    actor: scope.actor,
    sessionId: scope.sessionId,
    subjectRef,
    tool,
    args,
    result,
    // A refusal is never data, so it can never make an answer look supported.
    rowCount: isToolRefusal(result) ? 0 : rowCountOf(result),
  });
  return result;
};

const subjectInScope = async (
  scope: SessionScope,
  subjectRef: string,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<boolean> => {
  if (scope.mode !== "synthetic") return false;
  return subjectRowInScope(scope, await ports.findSubject(subjectRef));
};

const distinctUnits = (rows: readonly { readonly unitUcum: string }[]): string[] =>
  [...new Set(rows.map((row) => row.unitUcum))].sort();

type TimeWindow = Readonly<{ start: string; end: string }>;

/** One capped read; a window over the cap is refused rather than cut short. */
const readWindow = async (
  ports: QueryToolPorts,
  subjectRef: string,
  loinc: readonly string[],
  window: TimeWindow,
): Promise<readonly ObservationRecord[] | typeof ROW_CAP_EXCEEDED> => {
  const rows = await ports.findObservations({
    subjectRef,
    loinc,
    start: windowStartDate(window.start),
    end: windowEndDate(window.end),
    take: ANALYTICS_ROW_CAP + 1,
  });
  return rows.length > ANALYTICS_ROW_CAP ? ROW_CAP_EXCEEDED : rows;
};

const valuesOf = (rows: readonly ObservationRecord[]): number[] =>
  rows.map((row) => row.value);

export const runListSubjects = (
  scope: SessionScope,
  input: ListSubjectsInput,
): Promise<{ subjects: Array<{ subject_ref: string }> } | SubjectScopeViolation> =>
  audited(
    scope,
    "list_subjects",
    input,
    null,
    async () => {
      if (!cohortInScope(scope, input.cohort_id)) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const rows = await database().subject.findMany({
        where: { cohortId: input.cohort_id, isSynthetic: true },
        select: { subjectRef: true },
        orderBy: { subjectRef: "asc" },
        take: 200,
      });
      return {
        subjects: rows.map((row) => ({ subject_ref: row.subjectRef })),
      };
    },
    (result) => ("subjects" in result ? result.subjects.length : 0),
  );

export const runSubjectWindow = (
  scope: SessionScope,
  input: SubjectWindowInput,
): Promise<
  | { start: string | null; end: string | null; n_observations: number }
  | SubjectScopeViolation
> =>
  audited(
    scope,
    "subject_window",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const stats = await database().observation.aggregate({
        where: { subjectRef: input.subject_ref },
        _count: { _all: true },
        _min: { effectiveAt: true },
        _max: { effectiveAt: true },
      });
      const n = stats._count._all;
      return {
        start:
          n === 0 || stats._min.effectiveAt === null
            ? null
            : asIso(stats._min.effectiveAt),
        end:
          n === 0 || stats._max.effectiveAt === null
            ? null
            : asIso(stats._max.effectiveAt),
        n_observations: n,
      };
    },
    (result) => ("n_observations" in result ? result.n_observations : 0),
  );

export const runObservationsForSubject = (
  scope: SessionScope,
  input: ObservationsInput,
): Promise<{ rows: ObservationRow[] } | SubjectScopeViolation> =>
  audited(
    scope,
    "observations_for_subject",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const rows = await database().observation.findMany({
        where: {
          subjectRef: input.subject_ref,
          loinc: { in: input.loinc },
          effectiveAt: {
            gte: windowStartDate(input.start),
            lte: windowEndDate(input.end),
          },
        },
        orderBy: { effectiveAt: "asc" },
        take: input.limit,
      });
      return { rows: rows.map(mapRow) };
    },
    (result) => ("rows" in result ? result.rows.length : 0),
  );

export const runLatestByLoinc = (
  scope: SessionScope,
  input: LatestByLoincInput,
): Promise<{ rows: ObservationRow[] } | SubjectScopeViolation> =>
  audited(
    scope,
    "latest_by_loinc",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const rows = await database().observation.findMany({
        where: {
          subjectRef: input.subject_ref,
          loinc: { in: input.loinc },
        },
        orderBy: { effectiveAt: "desc" },
      });
      const seen = new Set<string>();
      const latest: ObservationRow[] = [];
      for (const row of rows) {
        if (seen.has(row.loinc)) continue;
        seen.add(row.loinc);
        latest.push(mapRow(row));
      }
      return { rows: latest };
    },
    (result) => ("rows" in result ? result.rows.length : 0),
  );

export const runSummaryStats = (
  scope: SessionScope,
  input: SummaryStatsInput,
): Promise<
  | {
      n: number;
      min: number | null;
      max: number | null;
      mean: number | null;
      unit: string | null;
    }
  | SubjectScopeViolation
  | MixedUnits
> =>
  audited(
    scope,
    "summary_stats",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const range = {
        subjectRef: input.subject_ref,
        loinc: input.loinc,
        effectiveAt: { gte: windowStartDate(input.start), lte: windowEndDate(input.end) },
      };
      const stats = await database().observation.aggregate({
        where: range,
        _count: { _all: true },
        _min: { value: true },
        _max: { value: true },
        _avg: { value: true },
      });
      const n = stats._count._all;
      if (n === 0) {
        return { n: 0, min: null, max: null, mean: null, unit: null };
      }
      // The aggregate would happily average kg with lb; check the units first.
      const units = distinctUnits(
        await database().observation.findMany({
          where: range,
          select: { unitUcum: true },
          distinct: ["unitUcum"],
        }),
      );
      if (units.length > 1) return mixedUnits(input.loinc, units);
      return {
        n,
        min: stats._min.value === null ? null : toNumber(stats._min.value),
        max: stats._max.value === null ? null : toNumber(stats._max.value),
        mean: stats._avg.value === null ? null : toNumber(stats._avg.value),
        unit: units[0] ?? null,
      };
    },
    (result) => ("n" in result ? result.n : 0),
  );

export type TrendResult = Readonly<{
  loinc: string;
  unit: string | null;
  n: number;
  first_at: string | null;
  last_at: string | null;
  slope_per_day: number | null;
  slope_unit: string | null;
  fitted_first: number | null;
  fitted_last: number | null;
}>;

export const runTrend = (
  scope: SessionScope,
  input: TrendInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<TrendResult | ToolRefusal> =>
  audited<TrendResult | ToolRefusal>(
    scope,
    "trend",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const rows = await readWindow(ports, input.subject_ref, [input.loinc], input);
      if (isToolRefusal(rows)) return rows;
      const units = distinctUnits(rows);
      if (units.length > 1) return mixedUnits(input.loinc, units);
      const unit = units[0] ?? null;
      const fit = olsSlopePerDay(
        rows.map((row) => ({ at: row.effectiveAt, value: row.value })),
      );
      const first = rows.at(0);
      const last = rows.at(-1);
      return {
        loinc: input.loinc,
        unit,
        n: rows.length,
        first_at: first ? asIso(first.effectiveAt) : null,
        last_at: last ? asIso(last.effectiveAt) : null,
        slope_per_day: fit?.slopePerDay ?? null,
        slope_unit: unit === null ? null : `${unit}/d`,
        fitted_first: fit?.fittedFirst ?? null,
        fitted_last: fit?.fittedLast ?? null,
      };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

export type BaselineDeviationResult = Readonly<{
  loinc: string;
  unit: string | null;
  baseline: Readonly<{
    start: string;
    end: string;
    n: number;
    median: number | null;
    mad: number | null;
  }>;
  target: Readonly<{ start: string; end: string; n: number; median: number | null }>;
  robust_z: number | null;
}>;

export const runBaselineDeviation = (
  scope: SessionScope,
  input: BaselineDeviationInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<BaselineDeviationResult | ToolRefusal> =>
  audited<BaselineDeviationResult | ToolRefusal>(
    scope,
    "baseline_deviation",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const codes = [input.loinc];
      const baselineRows = await readWindow(
        ports,
        input.subject_ref,
        codes,
        input.baseline,
      );
      if (isToolRefusal(baselineRows)) return baselineRows;
      const targetRows = await readWindow(ports, input.subject_ref, codes, input.target);
      if (isToolRefusal(targetRows)) return targetRows;
      const units = distinctUnits([...baselineRows, ...targetRows]);
      if (units.length > 1) return mixedUnits(input.loinc, units);
      const baseline = valuesOf(baselineRows);
      const target = valuesOf(targetRows);
      return {
        loinc: input.loinc,
        unit: units[0] ?? null,
        baseline: {
          start: input.baseline.start,
          end: input.baseline.end,
          n: baseline.length,
          median: median(baseline),
          mad: mad(baseline),
        },
        target: {
          start: input.target.start,
          end: input.target.end,
          n: target.length,
          median: median(target),
        },
        robust_z: robustZ(baseline, target),
      };
    },
    (result) => ("baseline" in result ? result.baseline.n + result.target.n : 0),
    ports,
  );

export type CoverageResult = Readonly<{
  start: string;
  end: string;
  days_in_window: number;
  codes: ReadonlyArray<
    Readonly<{
      loinc: string;
      unit: string | null;
      n: number;
      days_with_data: number;
      coverage_ratio: number;
      longest_gap_days: number;
    }>
  >;
}>;

export const runCoverage = (
  scope: SessionScope,
  input: CoverageInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<CoverageResult | ToolRefusal> =>
  audited<CoverageResult | ToolRefusal>(
    scope,
    "coverage",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const codes = [...new Set(input.loinc)];
      const rows = await readWindow(ports, input.subject_ref, codes, input);
      if (isToolRefusal(rows)) return rows;
      const perCode = codes.map((loinc) => {
        const own = rows.filter((row) => row.loinc === loinc);
        return { loinc, rows: own, units: distinctUnits(own) };
      });
      const mixed = perCode.find((code) => code.units.length > 1);
      if (mixed) return mixedUnits(mixed.loinc, mixed.units);
      const start = windowStartDate(input.start);
      const end = windowEndDate(input.end);
      return {
        start: input.start,
        end: input.end,
        days_in_window: daysInWindow(start, end),
        codes: perCode.map((code) => {
          const days = coverage(
            code.rows.map((row) => row.effectiveAt),
            start,
            end,
          );
          return {
            loinc: code.loinc,
            unit: code.units[0] ?? null,
            n: code.rows.length,
            days_with_data: days.daysWithData,
            coverage_ratio: days.coverageRatio,
            longest_gap_days: days.longestGapDays,
          };
        }),
      };
    },
    (result) =>
      "codes" in result ? result.codes.reduce((total, code) => total + code.n, 0) : 0,
    ports,
  );

export type CompareWindowsResult = Readonly<{
  loinc: string;
  unit: string | null;
  window_a: WindowSummary;
  window_b: WindowSummary;
  delta_b_minus_a: Readonly<{
    mean: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
  }>;
}>;

const summarise = (
  window: TimeWindow,
  rows: readonly ObservationRecord[],
): WindowSummary => summariseWindow(window, valuesOf(rows));

const delta = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : b - a;

export const runCompareWindows = (
  scope: SessionScope,
  input: CompareWindowsInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<CompareWindowsResult | ToolRefusal> =>
  audited<CompareWindowsResult | ToolRefusal>(
    scope,
    "compare_windows",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const codes = [input.loinc];
      const rowsA = await readWindow(ports, input.subject_ref, codes, input.window_a);
      if (isToolRefusal(rowsA)) return rowsA;
      const rowsB = await readWindow(ports, input.subject_ref, codes, input.window_b);
      if (isToolRefusal(rowsB)) return rowsB;
      const units = distinctUnits([...rowsA, ...rowsB]);
      if (units.length > 1) return mixedUnits(input.loinc, units);
      const a = summarise(input.window_a, rowsA);
      const b = summarise(input.window_b, rowsB);
      return {
        loinc: input.loinc,
        unit: units[0] ?? null,
        window_a: a,
        window_b: b,
        delta_b_minus_a: {
          mean: delta(a.mean, b.mean),
          median: delta(a.median, b.median),
          min: delta(a.min, b.min),
          max: delta(a.max, b.max),
        },
      };
    },
    (result) => ("window_a" in result ? result.window_a.n + result.window_b.n : 0),
    ports,
  );

/** One measure's readings in a window, for a view: every row, in time order. */
export type SeriesResult = Readonly<{
  measure: string;
  display: string | null;
  unit: string | null;
  n: number;
  points: ReadonlyArray<Readonly<{ at: string; value: number }>>;
}>;

type SeriesInput = Readonly<{
  subject_ref: string;
  loinc: string;
  start: string;
  end: string;
}>;

/**
 * A cohort measure's rows for `show_view`, scoped and audited like the other
 * query tools. Over the cap or in two units is refused, never cut or mixed.
 */
export const runTimeseries = (
  scope: SessionScope,
  input: SeriesInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<SeriesResult | ToolRefusal> =>
  audited<SeriesResult | ToolRefusal>(
    scope,
    "timeseries",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const rows = await readWindow(ports, input.subject_ref, [input.loinc], input);
      if (isToolRefusal(rows)) return rows;
      const units = distinctUnits(rows);
      if (units.length > 1) return mixedUnits(input.loinc, units);
      return {
        measure: input.loinc,
        display: rows.find((row) => row.display !== undefined)?.display ?? null,
        unit: units[0] ?? null,
        n: rows.length,
        points: rows.map((row) => ({ at: asIso(row.effectiveAt), value: row.value })),
      };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

/** A wearable reading as the user's synced snapshot holds it. */
export type WearableReading = Readonly<{
  at: string;
  value: number;
  label: string;
  unit: string | null;
}>;

/**
 * A wearable measure's readings for `show_view`. The readings come from the
 * snapshot the turn already loaded for this user; this filters them to the
 * window and audits the read like a query tool, so a view of them traces to
 * an audit row too.
 */
export const runWearableSeries = (
  scope: SessionScope,
  input: Readonly<{ key: string; start: string; end: string }>,
  readings: (key: string) => readonly WearableReading[],
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<SeriesResult> =>
  audited<SeriesResult>(
    scope,
    "wearable_series",
    input,
    null,
    async () => {
      const from = windowStartDate(input.start).getTime();
      const to = windowEndDate(input.end).getTime();
      const inWindow = readings(input.key)
        .filter((reading) => {
          const at = Date.parse(reading.at);
          return at >= from && at <= to;
        })
        .sort((a, b) => a.at.localeCompare(b.at));
      return {
        measure: input.key,
        display: inWindow[0]?.label ?? null,
        unit: inWindow[0]?.unit ?? null,
        n: inWindow.length,
        points: inWindow.map((reading) => ({ at: reading.at, value: reading.value })),
      };
    },
    (result) => result.n,
    ports,
  );

export type WearableCoverageResult = Readonly<{
  start: string;
  end: string;
  days_in_window: number;
  measures: ReadonlyArray<
    Readonly<{
      key: string;
      n: number;
      days_with_data: number;
      coverage_ratio: number;
      longest_gap_days: number;
    }>
  >;
}>;

/**
 * `coverage` for wearable keys: how many readings and days each key has in a
 * window. Like `wearable_series`, the readings come from the snapshot already
 * loaded for this user, and the read is audited like a query tool.
 */
export const runWearableCoverage = (
  scope: SessionScope,
  input: Readonly<{ keys: readonly string[]; start: string; end: string }>,
  readings: (key: string) => readonly WearableReading[],
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<WearableCoverageResult> =>
  audited<WearableCoverageResult>(
    scope,
    "wearable_coverage",
    input,
    null,
    async () => {
      const start = windowStartDate(input.start);
      const end = windowEndDate(input.end);
      const from = start.getTime();
      const to = end.getTime();
      return {
        start: input.start,
        end: input.end,
        days_in_window: daysInWindow(start, end),
        measures: [...new Set(input.keys)].map((key) => {
          const times = readings(key)
            .map((reading) => Date.parse(reading.at))
            .filter((at) => at >= from && at <= to)
            .map((at) => new Date(at));
          const days = coverage(times, start, end);
          return {
            key,
            n: times.length,
            days_with_data: days.daysWithData,
            coverage_ratio: days.coverageRatio,
            longest_gap_days: days.longestGapDays,
          };
        }),
      };
    },
    (result) => result.measures.reduce((total, measure) => total + measure.n, 0),
    ports,
  );

type RangePositionInput = z.infer<typeof rangePositionInput>;

export type RangePositionResult = Readonly<{
  loinc: string;
  start: string;
  end: string;
  /** Rows read in the window. */
  n: number;
  effective_at: string;
  value: number;
  unit: string;
}> &
  RangePlacement;

/**
 * `range_position`: the code's Anchor v3 range is checked first (no read when
 * there is none), then one fixed, capped read; the reading is picked in
 * `pickReading` (stats.ts) and placed in `placeReading` (range-position.ts).
 */
export const runRangePosition = (
  scope: SessionScope,
  input: RangePositionInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<RangePositionResult | ToolRefusal> =>
  audited<RangePositionResult | ToolRefusal>(
    scope,
    "range_position",
    input,
    input.subject_ref,
    async () => {
      if (scope.mode !== "synthetic") return SUBJECT_SCOPE_VIOLATION;
      const subject = await ports.findSubject(input.subject_ref);
      if (!subjectRowInScope(scope, subject)) return SUBJECT_SCOPE_VIOLATION;
      const noRange = rangeRefusalFor(input.loinc);
      if (noRange) return noRange;
      const rows = await readWindow(ports, input.subject_ref, [input.loinc], input);
      if (isToolRefusal(rows)) return rows;
      const units = distinctUnits(rows);
      if (units.length > 1) return mixedUnits(input.loinc, units);
      const at = input.pick === "at" && input.at ? new Date(input.at) : null;
      const reading = pickReading(rows, at);
      if (!reading) return noRows(input.loinc, at === null ? null : asIso(at));
      // Sex and birth year are stored for synthetic subjects only (#4).
      const placed = placeReading(input.loinc, reading, {
        sex: subject?.sex,
        birthYear: subject?.birthYear,
      });
      if (isToolRefusal(placed)) return placed;
      return {
        loinc: input.loinc,
        start: input.start,
        end: input.end,
        n: rows.length,
        effective_at: asIso(reading.effectiveAt),
        value: reading.value,
        unit: reading.unitUcum,
        ...placed,
      };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

type ConvertUnitInput = z.infer<typeof convertUnitInput>;

export type ConvertUnitResult = Readonly<{
  analyte: ConvertUnitInput["analyte"];
  from_value: number;
  from_unit: ConvertUnitInput["from"];
  /** Rounded half away from zero, as `rounding` states. */
  value: number;
  unrounded: number;
  unit: ConvertUnitInput["to"];
  formula: string;
  rounding: string;
}>;

/**
 * `convert_unit`: one value through the exact table in `unit-conversions.ts`.
 * It reads no rows, so there is no subject to scope, no row cap and no
 * no-rows case: the call is audited like any tool (subject_ref null,
 * row_count 0, so it never counts toward `sufficient_data`), and a pair the
 * table does not hold is refused with `UNSUPPORTED_CONVERSION`.
 */
export const runConvertUnit = (
  scope: SessionScope,
  input: ConvertUnitInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<ConvertUnitResult | UnsupportedConversion> =>
  audited<ConvertUnitResult | UnsupportedConversion>(
    scope,
    "convert_unit",
    input,
    null,
    async () => {
      const rule = findConversion(input.analyte, input.from, input.to);
      if (rule === null) {
        return unsupportedConversion(
          input.analyte,
          input.from,
          input.to,
          supportedPairs(input.analyte),
        );
      }
      const converted = applyConversion(rule, input.value);
      return {
        analyte: input.analyte,
        from_value: input.value,
        from_unit: input.from,
        value: converted.value,
        unrounded: converted.unrounded,
        unit: input.to,
        formula: converted.formula,
        rounding: converted.rounding,
      };
    },
    () => 0,
    ports,
  );

type CohortPositionInput = z.infer<typeof cohortPositionInput>;

export type CohortPositionResult = Readonly<{
  loinc: string;
  unit: string;
  start: string;
  end: string;
  cohort_id: string;
  /** The subject's own latest reading in the window. */
  effective_at: string;
  value: number;
  /** People in the cohort with a value in the window, the subject included. */
  n: number;
  n_lower: number;
  /** The subject included, so at least 1. */
  n_equal: number;
  n_higher: number;
  /** 100 × (n_lower + n_equal / 2) / n. */
  percentile: number;
  method: "mid-rank";
  /** Cohort rows read, the audit row count. */
  rows_read: number;
}>;

/** The subject's own cohort, or null when the subject is out of scope. */
const subjectCohort = async (
  scope: SessionScope,
  subjectRef: string,
  ports: QueryToolPorts,
): Promise<string | null> => {
  if (scope.mode !== "synthetic") return null;
  const subject = await ports.findSubject(subjectRef);
  return subject !== null && subjectRowInScope(scope, subject) ? subject.cohortId : null;
};

/**
 * `cohort_position`: one fixed, capped read of the code across the subject's
 * own synthetic cohort; each person's latest reading in `latestPerSubject`,
 * the rank in `midRankPercentile` (stats.ts). Out of scope, over the cohort
 * cap, mixed units, no reading for the subject and fewer than 10 people are
 * refused.
 */
export const runCohortPosition = (
  scope: SessionScope,
  input: CohortPositionInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<CohortPositionResult | ToolRefusal> =>
  audited<CohortPositionResult | ToolRefusal>(
    scope,
    "cohort_position",
    input,
    input.subject_ref,
    async () => {
      const cohortId = await subjectCohort(scope, input.subject_ref, ports);
      if (cohortId === null) return SUBJECT_SCOPE_VIOLATION;
      const rows = await ports.findCohortObservations({
        cohortId,
        loinc: input.loinc,
        start: windowStartDate(input.start),
        end: windowEndDate(input.end),
        take: COHORT_ROW_CAP + 1,
      });
      if (rows.length > COHORT_ROW_CAP) return COHORT_ROW_CAP_EXCEEDED;
      const units = distinctUnits(rows);
      if (units.length > 1) return mixedUnits(input.loinc, units);
      const latest = latestPerSubject(rows);
      const own = latest.get(input.subject_ref);
      if (!own) return noRows(input.loinc, null);
      if (latest.size < COHORT_MINIMUM) return cohortTooSmall(input.loinc, latest.size);
      const rank = midRankPercentile(
        own.value,
        [...latest.values()].map((reading) => reading.value),
      );
      if (rank === null) return noRows(input.loinc, null);
      return {
        loinc: input.loinc,
        unit: own.unitUcum,
        start: input.start,
        end: input.end,
        cohort_id: cohortId,
        effective_at: asIso(own.effectiveAt),
        value: own.value,
        n: rank.n,
        n_lower: rank.nLower,
        n_equal: rank.nEqual,
        n_higher: rank.nHigher,
        percentile: rank.percentile,
        method: "mid-rank",
        rows_read: rows.length,
      };
    },
    (result) => ("rows_read" in result ? result.rows_read : 0),
    ports,
  );

type ConditionsTimelineInput = z.infer<typeof conditionsTimelineInput>;
type MedicationsTimelineInput = z.infer<typeof medicationsTimelineInput>;

type TimelineEcho = Readonly<{
  subject_ref: string;
  start: string;
  end: string;
  /** The filters as asked, null when not given. */
  status: string | null;
  code: string | null;
}>;

export type ConditionsTimelineResult = TimelineEcho & ConditionsTimeline;
export type MedicationsTimelineResult = TimelineEcho & MedicationsTimeline;

const clinicalQuery = (
  input: Readonly<{
    subject_ref: string;
    start: string;
    end: string;
    status?: string;
    code?: string;
  }>,
): ClinicalQuery => ({
  subjectRef: input.subject_ref,
  start: windowStartDate(input.start),
  end: windowEndDate(input.end),
  ...(input.status === undefined ? {} : { status: input.status }),
  ...(input.code === undefined ? {} : { code: input.code }),
  take: CLINICAL_ROW_CAP + 1,
});

const echo = (
  input: Readonly<{
    subject_ref: string;
    start: string;
    end: string;
    status?: string;
    code?: string;
  }>,
): TimelineEcho => ({
  subject_ref: input.subject_ref,
  start: input.start,
  end: input.end,
  status: input.status ?? null,
  code: input.code ?? null,
});

/**
 * `conditions_timeline`: scope first, one fixed capped read of the subject's
 * conditions overlapping the window, the ordering and counts in
 * `conditionsTimeline` (clinical-timeline.ts). None is refused with NO_ROWS and
 * its reason; over the cap with ROW_CAP_EXCEEDED.
 */
export const runConditionsTimeline = (
  scope: SessionScope,
  input: ConditionsTimelineInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<ConditionsTimelineResult | ToolRefusal> =>
  audited<ConditionsTimelineResult | ToolRefusal>(
    scope,
    "conditions_timeline",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const find = ports.findConditions ?? findConditionsInDatabase;
      const rows = await find(clinicalQuery(input));
      if (rows.length > CLINICAL_ROW_CAP) return recordCapExceeded(CLINICAL_ROW_CAP);
      if (rows.length === 0) return noRecords("condition", input);
      return { ...echo(input), ...conditionsTimeline(rows) };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

/**
 * `medications_timeline`: scope first, one fixed capped read of the subject's
 * medication requests authored in the window, the ordering and counts in
 * `medicationsTimeline`. Dosage is the record's own text or null; nothing is
 * added to it.
 */
export const runMedicationsTimeline = (
  scope: SessionScope,
  input: MedicationsTimelineInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<MedicationsTimelineResult | ToolRefusal> =>
  audited<MedicationsTimelineResult | ToolRefusal>(
    scope,
    "medications_timeline",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const find = ports.findMedicationRequests ?? findMedicationRequestsInDatabase;
      const rows = await find(clinicalQuery(input));
      if (rows.length > CLINICAL_ROW_CAP) return recordCapExceeded(CLINICAL_ROW_CAP);
      if (rows.length === 0) return noRecords("medication request", input);
      return { ...echo(input), ...medicationsTimeline(rows) };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

type SleepSummaryInput = z.infer<typeof sleepSummaryInput>;
type HrvTrendInput = z.infer<typeof hrvTrendInput>;
type RestingHrTrendInput = z.infer<typeof restingHrTrendInput>;
type TrainingLoadInput = z.infer<typeof trainingLoadInput>;

type WearableInput = Readonly<{
  subject_ref?: string;
  source: (typeof WEARABLE_SOURCE_CHOICES)[number];
  start: string;
  end: string;
}>;

type WearablePlan =
  | Readonly<{ kind: "snapshots"; sources: readonly WearableSource[] }>
  | Readonly<{ kind: "synthetic"; subjectRef: string }>;

/**
 * Which readings a wearable tool may read, scope first. Personal mode: the
 * linked snapshots of this turn, never a subject_ref. Synthetic mode: the
 * named subject's synthetic series, in scope like any cohort read; it belongs
 * to no vendor, so only `source: all` reads it.
 */
const planWearableRead = async (
  scope: SessionScope,
  input: WearableInput,
  wearables: WearableSummaries,
  ports: QueryToolPorts,
): Promise<WearablePlan | SubjectScopeViolation | SourceNotConnected> => {
  if (scope.mode === "personal") {
    if (input.subject_ref !== undefined) return SUBJECT_SCOPE_VIOLATION;
    const linked = linkedSources(wearables);
    if (input.source === "all") {
      return linked.length === 0
        ? sourceNotConnected("all", linked)
        : { kind: "snapshots", sources: linked };
    }
    return linked.includes(input.source)
      ? { kind: "snapshots", sources: [input.source] }
      : sourceNotConnected(input.source, linked);
  }
  if (
    input.subject_ref === undefined ||
    !(await subjectInScope(scope, input.subject_ref, ports))
  ) {
    return SUBJECT_SCOPE_VIOLATION;
  }
  return input.source === "all"
    ? { kind: "synthetic", subjectRef: input.subject_ref }
    : sourceNotConnected(input.source, ["synthetic"]);
};

const spanOf = (input: TimeWindow): Span => ({
  from: windowStartDate(input.start),
  to: windowEndDate(input.end),
});

/**
 * The window plus the 35 days a trend or a load compares, through the end of
 * the last day, so one capped read holds everything the result uses.
 */
const comparedRead = (input: TimeWindow): TimeWindow => {
  const endDay = utcDay(windowEndDate(input.end));
  const { baseline } = recentAndBaseline(endDay);
  return {
    start:
      windowStartDate(baseline.start).getTime() < windowStartDate(input.start).getTime()
        ? baseline.start
        : input.start,
    end: endDay,
  };
};

const wearableRowCount = (result: object): number =>
  "n" in result && typeof result.n === "number" ? result.n : 0;

const wearableTrendTool =
  (tool: "hrv_trend" | "resting_hr_trend", measure: TrendMeasure) =>
  (
    scope: SessionScope,
    input: HrvTrendInput | RestingHrTrendInput,
    ports: QueryToolPorts = defaultQueryToolPorts(),
    wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
  ): Promise<WearableTrendResult | ToolRefusal> =>
    audited<WearableTrendResult | ToolRefusal>(
      scope,
      tool,
      input,
      input.subject_ref ?? null,
      async () => {
        const plan = await planWearableRead(scope, input, wearables, ports);
        if (isToolRefusal(plan)) return plan;
        const span = spanOf(input);
        const endDay = utcDay(span.to);
        const config = TREND_MEASURES[measure];
        if (plan.kind === "snapshots") {
          const series = plan.sources.map((source) => ({
            source,
            key: config.snapshot[source] ?? "",
            readings: snapshotReadings(wearables, source, config.snapshot[source]),
          }));
          return wearableTrend(measure, input.source, input, span, endDay, series);
        }
        const rows = await readWindow(
          ports,
          plan.subjectRef,
          [config.synthetic],
          comparedRead(input),
        );
        if (isToolRefusal(rows)) return rows;
        return wearableTrend(measure, input.source, input, span, endDay, [
          {
            source: "synthetic",
            key: config.synthetic,
            readings: syntheticReadings(rows, config.synthetic),
          },
        ]);
      },
      wearableRowCount,
      ports,
    );

/** `hrv_trend`: daily HRV per source, the maths in `wearableTrend` (wearable-analytics.ts). */
export const runHrvTrend = wearableTrendTool("hrv_trend", "hrv");

/** `resting_hr_trend`: daily resting heart rate per source, as `hrv_trend`. */
export const runRestingHrTrend = wearableTrendTool("resting_hr_trend", "resting_hr");

/** `sleep_summary`: main sleep per night per source (`sleepSummary`, wearable-analytics.ts). */
export const runSleepSummary = (
  scope: SessionScope,
  input: SleepSummaryInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
  wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
): Promise<SleepSummaryResult | ToolRefusal> =>
  audited<SleepSummaryResult | ToolRefusal>(
    scope,
    "sleep_summary",
    input,
    input.subject_ref ?? null,
    async () => {
      const plan = await planWearableRead(scope, input, wearables, ports);
      if (isToolRefusal(plan)) return plan;
      const span = spanOf(input);
      if (plan.kind === "snapshots") {
        const series = plan.sources.map((source) => ({
          source,
          fields: Object.fromEntries(
            Object.entries(SLEEP_SOURCES[source].fields).map(([field, family]) => [
              field,
              snapshotReadings(wearables, source, family),
            ]),
          ),
        }));
        return sleepSummary(input.source, input, span, series);
      }
      const rows = await readWindow(ports, plan.subjectRef, SYNTHETIC_SLEEP_CODES, input);
      if (isToolRefusal(rows)) return rows;
      const fields = Object.fromEntries(
        Object.entries(SLEEP_SOURCES.synthetic.fields).map(([field, code]) => [
          field,
          syntheticReadings(rows, code),
        ]),
      );
      return sleepSummary(input.source, input, span, [{ source: "synthetic", fields }]);
    },
    wearableRowCount,
    ports,
  );

/** `training_load`: workouts per day or week per source (`trainingLoad`, wearable-analytics.ts). */
export const runTrainingLoad = (
  scope: SessionScope,
  input: TrainingLoadInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
  wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
): Promise<TrainingLoadResult | ToolRefusal> =>
  audited<TrainingLoadResult | ToolRefusal>(
    scope,
    "training_load",
    input,
    input.subject_ref ?? null,
    async () => {
      const plan = await planWearableRead(scope, input, wearables, ports);
      if (isToolRefusal(plan)) return plan;
      const span = spanOf(input);
      const endDay = utcDay(span.to);
      if (plan.kind === "snapshots") {
        const sources = plan.sources.map((source) => ({
          source,
          parts: snapshotWorkouts(wearables, source),
        }));
        return trainingLoad(input.source, input, span, endDay, sources);
      }
      const rows = await readWindow(
        ports,
        plan.subjectRef,
        SYNTHETIC_WORKOUT_CODES,
        comparedRead(input),
      );
      if (isToolRefusal(rows)) return rows;
      return trainingLoad(input.source, input, span, endDay, [
        { source: "synthetic", parts: syntheticWorkouts(rows) },
      ]);
    },
    wearableRowCount,
    ports,
  );
