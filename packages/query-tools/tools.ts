import "server-only";

import { database } from "@/infrastructure/database";

import {
  defaultQueryToolPorts,
  type ObservationRecord,
  type QueryToolPorts,
  toNumber,
} from "./ports";
import {
  ANALYTICS_ROW_CAP,
  isToolRefusal,
  mixedUnits,
  type MixedUnits,
  ROW_CAP_EXCEEDED,
  type ToolRefusal,
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
} from "./schemas";
import { windowEndDate, windowStartDate } from "./schemas";
import {
  coverage,
  daysInWindow,
  mad,
  maximum,
  mean,
  median,
  minimum,
  olsSlopePerDay,
  robustZ,
} from "./stats";
import type { z } from "zod";

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

type WindowSummary = Readonly<{
  start: string;
  end: string;
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}>;

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
): WindowSummary => {
  const values = valuesOf(rows);
  return {
    start: window.start,
    end: window.end,
    n: values.length,
    mean: mean(values),
    median: median(values),
    min: minimum(values),
    max: maximum(values),
  };
};

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
