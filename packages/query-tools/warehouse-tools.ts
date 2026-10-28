import "server-only";

import { database } from "@/infrastructure/database";

import {
  defaultQueryToolPorts,
  type ObservationRecord,
  type QueryToolPorts,
  toNumber,
} from "./ports";
import {
  COHORT_MINIMUM,
  COHORT_ROW_CAP,
  COHORT_ROW_CAP_EXCEEDED,
  cohortTooSmall,
  isToolRefusal,
  mixedUnits,
  type MixedUnits,
  type ToolRefusal,
  noReadingForCodes,
  type NoReadingForCodes,
  noRows,
  unsupportedConversion,
  type UnsupportedConversion,
} from "./refusals";
import {
  cohortInScope,
  type CohortOutOfScope,
  cohortOutOfScope,
  SUBJECT_SCOPE_VIOLATION,
  SYNTHETIC_COHORTS,
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
} from "./schemas";
import { windowEndDate, windowStartDate } from "./schemas";
import {
  coverage,
  daysInWindow,
  mad,
  median,
  olsSlopePerDay,
  robustZ,
  pickReading,
  summariseWindow,
  type WindowSummary,
  latestPerSubject,
  midRankPercentile,
} from "./stats";
import { placeReading, type RangePlacement, rangeRefusalFor } from "./range-position";
import { applyConversion, findConversion, supportedPairs } from "./unit-conversions";
import type { z } from "zod";
import {
  type ObservationRow,
  asIso,
  mapRow,
  audited,
  subjectInScope,
  distinctUnits,
  type TimeWindow,
  readWindow,
  valuesOf,
} from "./tool-core";

/** Reads of the synthetic warehouse and the analytics over them (tools.ts re-exports these). */
export type ListSubjectsInput = z.infer<typeof listSubjectsInput>;
export type SubjectWindowInput = z.infer<typeof subjectWindowInput>;
export type ObservationsInput = z.infer<typeof observationsForSubjectInput>;
export type LatestByLoincInput = z.infer<typeof latestByLoincInput>;
export type SummaryStatsInput = z.infer<typeof summaryStatsInput>;
export type TrendInput = z.infer<typeof trendInput>;
export type BaselineDeviationInput = z.infer<typeof baselineDeviationInput>;
export type CoverageInput = z.infer<typeof coverageInput>;
export type CompareWindowsInput = z.infer<typeof compareWindowsInput>;

export const runListSubjects = (
  scope: SessionScope,
  input: ListSubjectsInput,
): Promise<{ subjects: Array<{ subject_ref: string }> } | CohortOutOfScope> =>
  audited(
    scope,
    "list_subjects",
    input,
    null,
    async () => {
      if (!cohortInScope(scope, input.cohort_id)) {
        if (scope.mode !== "synthetic") return cohortOutOfScope(scope, []);
        const loaded = await database().subject.groupBy({
          by: ["cohortId"],
          where: { cohortId: { in: [...SYNTHETIC_COHORTS] }, isSynthetic: true },
          orderBy: { cohortId: "asc" },
          take: 10,
        });
        return cohortOutOfScope(
          scope,
          loaded.map((row) => row.cohortId),
        );
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
): Promise<
  | { rows: ObservationRow[]; codes_without_rows: string[] }
  | NoReadingForCodes
  | SubjectScopeViolation
> =>
  audited(
    scope,
    "latest_by_loinc",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      // One newest row per code: at most 20 rows, however long the history.
      const codes = [...new Set(input.loinc)];
      const newest = await Promise.all(
        codes.map((loinc) =>
          database().observation.findMany({
            where: { subjectRef: input.subject_ref, loinc },
            orderBy: { effectiveAt: "desc" },
            take: 1,
          }),
        ),
      );
      const latest: ObservationRow[] = newest.flat().map(mapRow);
      const seen = new Set(latest.map((row) => row.loinc));
      if (latest.length === 0) return noReadingForCodes(input.loinc);
      return {
        rows: latest,
        codes_without_rows: input.loinc.filter((code) => !seen.has(code)),
      };
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

export const summarise = (
  window: TimeWindow,
  rows: readonly ObservationRecord[],
): WindowSummary => summariseWindow(window, valuesOf(rows));

export const delta = (a: number | null, b: number | null): number | null =>
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

export type SeriesInput = Readonly<{
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

export type RangePositionInput = z.infer<typeof rangePositionInput>;

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

export type ConvertUnitInput = z.infer<typeof convertUnitInput>;

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

export type CohortPositionInput = z.infer<typeof cohortPositionInput>;

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
export const subjectCohort = async (
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
