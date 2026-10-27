import {
  type BiomarkerCardSpec,
  type CompareSpec,
  type TableSpec,
  type ViewPoint,
  writtenDecimals,
} from "@/infrastructure/chat-view";
import type { CompareLayout } from "@/infrastructure/view-specs";
import type { WindowSummary } from "@/packages/query-tools/stats";
import type { RangePositionResult, TrendResult } from "@/packages/query-tools/tools";

/**
 * The specs of `chart.compare`, `biomarker.card` and `table`, built from what
 * audited query tools returned and nothing else. Pure, so each rule is tested
 * with exact values; `show-view-tool.ts` runs the queries.
 */

type Window = Readonly<{ start: string; end: string }>;

/** compare_windows' window_a and window_b (or the same summary of wearable readings), with the points drawn. */
export const compareSpecOf = (
  input: Readonly<{
    measure: string;
    label: string;
    unit: string | null;
    subject: string | null;
    layout: CompareLayout;
    before: WindowSummary;
    after: WindowSummary;
    beforePoints: readonly ViewPoint[];
    afterPoints: readonly ViewPoint[];
  }>,
): CompareSpec => ({
  measure: input.measure,
  label: input.label,
  unit: input.unit,
  subject: input.subject,
  layout: input.layout,
  before: {
    start: input.before.start,
    end: input.before.end,
    n: input.before.n,
    mean: input.before.mean,
    points: [...input.beforePoints],
  },
  after: {
    start: input.after.start,
    end: input.after.end,
    n: input.after.n,
    mean: input.after.mean,
    points: [...input.afterPoints],
  },
  meanDelta:
    input.before.mean === null || input.after.mean === null
      ? null
      : input.after.mean - input.before.mean,
});

/**
 * Up, down or level from `trend`'s fit: the fitted change over the readings,
 * rounded to the decimals the value was written with (`writtenDecimals`). A change too small to show
 * is level. Null when `trend` fitted nothing (under three readings or two days).
 */
export const trendDirection = (
  trend: Pick<TrendResult, "fitted_first" | "fitted_last">,
  decimals: number,
): "up" | "down" | "level" | null => {
  if (trend.fitted_first === null || trend.fitted_last === null) return null;
  const scale = 10 ** decimals;
  const change = Math.round((trend.fitted_last - trend.fitted_first) * scale) / scale;
  return change > 0 ? "up" : change < 0 ? "down" : "level";
};

/** The marker's LOINC display without its bracketed property: `Sodium`. */
export const cardLabel = (loincDisplay: string | null, loinc: string): string =>
  loincDisplay?.split(" [")[0]?.trim() || loinc;

/**
 * The card: `range_position`'s latest reading, its Anchor v3 range and
 * position (or what the range depends on), and `trend`'s direction and n over
 * the same window.
 */
export const cardSpecOf = (
  input: Readonly<{
    label: string;
    subject: string;
    window: Window;
    placed: RangePositionResult;
    trend: TrendResult;
  }>,
): BiomarkerCardSpec => ({
  measure: input.placed.loinc,
  label: input.label,
  subject: input.subject,
  window: { start: input.window.start, end: input.window.end },
  value: input.placed.value,
  unit: input.placed.unit,
  at: input.placed.effective_at,
  n: input.placed.n,
  range: input.placed.range === null ? null : { ...input.placed.range },
  position: input.placed.position,
  dependsOn: [...input.placed.depends_on],
  trend: {
    n: input.trend.n,
    direction: trendDirection(input.trend, writtenDecimals(input.placed.value)),
    slopePerDay: input.trend.slope_per_day,
    slopeUnit: input.trend.slope_unit,
  },
});

/** Rows a table shows; the rest are counted in `total`. */
export const TABLE_ROW_CAP = 50;

type ColumnFormat = TableSpec["columns"][number]["format"];

/**
 * Every column a query tool's rows may carry, in the order a table shows
 * them. A row field not listed here is never shown.
 */
const TABLE_COLUMNS: readonly Readonly<{
  keys: readonly string[];
  label: string;
  format: ColumnFormat;
}>[] = [
  { keys: ["effective_at", "at"], label: "Date", format: "date" },
  { keys: ["subject_ref"], label: "Subject", format: "text" },
  { keys: ["display", "label"], label: "Measure", format: "text" },
  { keys: ["loinc"], label: "LOINC", format: "text" },
  { keys: ["key"], label: "Key", format: "text" },
  { keys: ["value"], label: "Value", format: "number" },
  { keys: ["unit_ucum", "unit"], label: "Unit", format: "text" },
  { keys: ["n"], label: "Readings", format: "number" },
  { keys: ["n_observations"], label: "Observations", format: "number" },
  { keys: ["days_with_data"], label: "Days with data", format: "number" },
  { keys: ["coverage_ratio"], label: "Coverage", format: "number" },
  { keys: ["longest_gap_days"], label: "Longest gap (days)", format: "number" },
  { keys: ["first_at"], label: "First", format: "date" },
  { keys: ["last_at"], label: "Last", format: "date" },
];

/** The list in a query tool's output that holds its rows. */
const ROW_KEYS = ["rows", "points", "subjects", "codes", "measures"] as const;

type Row = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The rows of any query tool output that has rows; none for any other output. */
export const rowsOf = (output: unknown): readonly Row[] => {
  if (!isRecord(output)) return [];
  const key = ROW_KEYS.find((name) => Array.isArray(output[name]));
  const rows = key === undefined ? [] : output[key];
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
};

type Cell = string | number | null;

const cellOf = (value: unknown, format: ColumnFormat): Cell => {
  if (format === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return typeof value === "string" ? value : null;
};

/**
 * The columns for these rows, chosen here and never by the model: each listed
 * column some row fills, without a text column that reads the same in every
 * row of several (the unit or subject, which the view's caption already says).
 */
export const tableColumns = (rows: readonly Row[]): TableSpec["columns"] =>
  TABLE_COLUMNS.flatMap((column) => {
    const key = column.keys.find((name) =>
      rows.some((row) => cellOf(row[name], column.format) !== null),
    );
    if (key === undefined) return [];
    const cells = rows.map((row) => cellOf(row[key], column.format));
    const constantText =
      column.format === "text" && rows.length > 1 && new Set(cells).size === 1;
    return constantText ? [] : [{ key, label: column.label, format: column.format }];
  });

/** A table of a query tool's rows: its own columns, the first `TABLE_ROW_CAP` rows in order. */
export const tableSpecOf = (
  input: Readonly<{
    output: unknown;
    measure: string;
    label: string;
    unit: string | null;
    window: Window;
    subject: string | null;
  }>,
): TableSpec => {
  const rows = rowsOf(input.output);
  const columns = tableColumns(rows);
  return {
    measure: input.measure,
    label: input.label,
    unit: input.unit,
    window: { start: input.window.start, end: input.window.end },
    subject: input.subject,
    columns,
    rows: rows
      .slice(0, TABLE_ROW_CAP)
      .map((row) =>
        Object.fromEntries(
          columns.map((column) => [column.key, cellOf(row[column.key], column.format)]),
        ),
      ),
    total: rows.length,
  };
};
