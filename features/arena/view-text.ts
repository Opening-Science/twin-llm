import {
  type BiomarkerCardSpec,
  type CompareSpec,
  type TableSpec,
  writtenDecimals,
} from "@/infrastructure/chat-view";
import {
  EMPTY_VALUE,
  formatDate,
  formatNumber,
  withUnit,
} from "@/infrastructure/format-measure";

/**
 * The words the compare chart, the biomarker card and the table show. Text
 * carries the meaning (above, below, rising), never colour alone, so every
 * label is here and tested with exact strings. Pure.
 */

/** A mean, or a difference of means, is shown to one decimal. */
export const MEAN_DECIMALS = 1;

const unitText = (number: string, unit: string | null): string =>
  unit ? withUnit(number, unit) : number;

/** `2026-10-02T08:00:00.000Z` as `2 Oct 2026`. */
export const dayText = (iso: string): string => {
  const day = formatDate(iso.slice(0, 10));
  return day === EMPTY_VALUE ? iso : day;
};

type CompareWindow = CompareSpec["before"];

/** `n = 7 · mean 7.1 h`; a window with no readings has no mean, never 0. */
export const compareWindowText = (
  window: CompareWindow,
  unit: string | null,
  decimals: number,
): string =>
  window.n === 0 || window.mean === null
    ? "n = 0 · no readings"
    : `n = ${window.n} · mean ${unitText(formatNumber(window.mean, decimals), unit)}`;

/** `Mean 0.4 h higher than before`, `… lower …`, or `Same mean as before`. */
export const compareDeltaText = (spec: CompareSpec, decimals: number): string | null => {
  if (spec.meanDelta === null) return null;
  const size = formatNumber(Math.abs(spec.meanDelta), decimals);
  if (size === formatNumber(0, decimals)) return "Same mean as before";
  return `Mean ${unitText(size, spec.unit)} ${spec.meanDelta > 0 ? "higher" : "lower"} than before`;
};

const FACT_WORDS: Readonly<Record<BiomarkerCardSpec["dependsOn"][number], string>> = {
  sex: "sex",
  age: "age",
  timing: "timing (fasting, time of day or cycle)",
};

const andList = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

/** `Within the range`, `Above the range`, `Below the range`, or `Range depends on sex and age`. */
export const positionText = (spec: BiomarkerCardSpec): string => {
  if (spec.position === "within") return "Within the range";
  if (spec.position === "above") return "Above the range";
  if (spec.position === "below") return "Below the range";
  return spec.dependsOn.length > 0
    ? `Range depends on ${andList(spec.dependsOn.map((fact) => FACT_WORDS[fact]))}, which the record does not hold`
    : "No position";
};

/** `3.6–5.5 mmol/L`, `≤ 5.7%`, `≥ 3 ng/mL`; null when no single range applies. */
export const rangeText = (spec: BiomarkerCardSpec): string | null => {
  const { range } = spec;
  if (range === null) return null;
  const bound = (value: number) => formatNumber(value, writtenDecimals(value));
  if (range.low !== null && range.high !== null)
    return unitText(`${bound(range.low)}–${bound(range.high)}`, range.unit);
  if (range.high !== null) return unitText(`≤ ${bound(range.high)}`, range.unit);
  if (range.low !== null) return unitText(`≥ ${bound(range.low)}`, range.unit);
  return null;
};

/** `Anchor v3, general adult`: where the range comes from and for whom. */
export const rangeSourceText = (spec: BiomarkerCardSpec): string | null =>
  spec.range === null
    ? null
    : `${spec.range.source}, ${spec.range.population.replaceAll("_", " ")}`;

export const valueText = (spec: BiomarkerCardSpec): string =>
  unitText(formatNumber(spec.value, writtenDecimals(spec.value)), spec.unit);

const ARROWS = { up: "↑", down: "↓", level: "→" } as const;
const TREND_WORDS = { up: "Rising", down: "Falling", level: "Level" } as const;

/** `↑ Rising · n = 12`, or why there is no direction. */
export const trendText = (spec: BiomarkerCardSpec): string => {
  const { direction, n } = spec.trend;
  return direction === null
    ? `No trend: too few readings · n = ${n}`
    : `${ARROWS[direction]} ${TREND_WORDS[direction]} · n = ${n}`;
};

/** `Showing first 50 of 120`; null when every row is shown. */
export const tableNote = (spec: TableSpec): string | null =>
  spec.total > spec.rows.length
    ? `Showing first ${spec.rows.length} of ${spec.total}`
    : null;

/** A cell as the table shows it: dates as days, numbers at the column's decimals. */
export const cellText = (
  value: string | number | null | undefined,
  format: TableSpec["columns"][number]["format"],
  decimals: number,
): string => {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (format === "date" && typeof value === "string") return dayText(value);
  if (format === "number" && typeof value === "number")
    return formatNumber(value, decimals);
  return String(value);
};

/** Decimals for each number column: as many as its values were written with, at most three. */
export const columnDecimals = (spec: TableSpec): Readonly<Record<string, number>> =>
  Object.fromEntries(
    spec.columns.map((column) => [
      column.key,
      spec.rows.reduce((most, row) => {
        const value = row[column.key];
        return typeof value === "number" ? Math.max(most, writtenDecimals(value)) : most;
      }, 0),
    ]),
  );

/**
 * Where the range and the value sit on the card's bar, as fractions of its
 * width. The bar spans the range plus a quarter of its width each side (or
 * the value, when it lies further out); an open bound runs to that edge.
 * Null without a range.
 */
export const rangeBar = (
  spec: BiomarkerCardSpec,
): Readonly<{ from: number; to: number; marker: number }> | null => {
  const { range } = spec;
  if (range === null || (range.low === null && range.high === null)) return null;
  const low = range.low ?? Math.min(0, spec.value);
  const high = range.high ?? Math.max(low * 2, spec.value, low + 1);
  const pad = (high - low) / 4 || 1;
  const start = Math.min(low - (range.low === null ? 0 : pad), spec.value);
  const end = Math.max(high + pad, spec.value);
  const at = (value: number) => (value - start) / (end - start);
  return {
    from: range.low === null ? 0 : at(low),
    to: range.high === null ? 1 : at(high),
    marker: at(spec.value),
  };
};
