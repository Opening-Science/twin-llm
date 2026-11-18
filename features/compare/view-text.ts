import {
  type BiomarkerCardSpec,
  type ChatView,
  type CompareSpec,
  type ViewPoint,
  writtenDecimals,
} from "@/infrastructure/chat-view";
import {
  EMPTY_VALUE,
  formatDate,
  formatNumber,
  formatUcumUnit,
  withUnit,
} from "@/infrastructure/format-measure";

/**
 * The words and number formats of the views in an answer (SPEC 5.5): what a
 * chart says in text, so the meaning never rests on a colour or a line.
 * Pure, so the tests pin every sentence.
 */

/** A view's stable anchor in the page, so the Outputs panel can scroll to it. */
export const viewAnchorId = (answerId: string, viewId: string): string =>
  `view-${answerId}-${viewId}`.replace(/[^A-Za-z0-9_-]/g, "-");

export const NO_READINGS_IN_WINDOW = "No readings in this window.";
export const NO_READINGS_IN_EITHER = "No readings in either window.";

/** A unit as a reader reads it ("bpm" for a heart rate's `/min`); "" for none. */
export const unitText = (unit: string | null, label = ""): string =>
  unit === null ? "" : formatUcumUnit(unit, label);

/** The caption's right-hand side: the unit and, when there is one, the subject. */
export const captionAside = (view: ChatView): string => {
  const label = "label" in view.spec ? view.spec.label : "";
  const unit = unitText(view.spec.unit, label);
  const subject = view.spec.subject;
  const parts = [unit, subject === null ? "" : `subject ${subject.slice(0, 8)}`];
  return parts.filter((part) => part !== "").join(" · ");
};

/** Integer data shows no decimals; anything else one. */
export const seriesDecimals = (values: readonly number[]): number =>
  values.every((value) => Number.isInteger(value)) ? 0 : 1;

/** A number with its unit, at `decimals`. */
export const valueWithUnit = (
  value: number,
  unit: string | null,
  decimals: number,
  label = "",
): string => {
  const shown = unitText(unit, label);
  const number = formatNumber(value, decimals);
  return shown === "" ? number : withUnit(number, shown);
};

const timeOf = (at: string): number =>
  Date.parse(at.length === 10 ? `${at}T00:00:00Z` : at);

const DAY_MS = 86_400_000;

/**
 * The time span a chart draws: the view's window, or the points' own range
 * when some reading falls outside it. The end day is drawn whole.
 */
export const seriesDomain = (
  points: readonly ViewPoint[],
  window: Readonly<{ start: string; end: string }>,
): readonly [number, number] => {
  const start = timeOf(window.start);
  const endRaw = timeOf(window.end);
  const end = window.end.length === 10 ? endRaw + DAY_MS - 1 : endRaw;
  const times = points.map((point) => timeOf(point.at)).filter(Number.isFinite);
  const fits =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    times.every((time) => time >= start && time <= end);
  if (fits) return [start, end];
  if (times.length === 0) return [0, 1];
  return [Math.min(...times), Math.max(...times)];
};

/** A point's time in ms, for drawing. */
export const pointTime = (point: ViewPoint): number => timeOf(point.at);

/** A day as "1 Oct 2026", from a date or a timestamp; anything else as given. */
export const dayOf = (at: string): string => {
  const day = formatDate(at.slice(0, 10));
  return day === EMPTY_VALUE ? at : day;
};

// --- comparison --------------------------------------------------------------

type CompareWindow = CompareSpec["before"];

/** The decimals both windows share: none for whole-number data and means, else one. */
export const compareDecimals = (spec: CompareSpec): number =>
  seriesDecimals([
    ...spec.before.points.map((point) => point.value),
    ...spec.after.points.map((point) => point.value),
    ...(spec.before.mean === null ? [] : [spec.before.mean]),
    ...(spec.after.mean === null ? [] : [spec.after.mean]),
  ]);

/** "n = 7 · mean 7.1 h", or "n = 0 · no readings". */
export const windowSummary = (
  window: CompareWindow,
  unit: string | null,
  decimals: number,
  label = "",
): string =>
  window.n === 0 || window.mean === null
    ? `n = ${String(window.n)} · no readings`
    : `n = ${String(window.n)} · mean ${valueWithUnit(window.mean, unit, decimals, label)}`;

/** "Mean 0.4 h higher than before", "… lower …", "Same mean as before"; null when unknown. */
export const deltaLine = (
  meanDelta: number | null,
  unit: string | null,
  decimals: number,
  label = "",
): string | null => {
  if (meanDelta === null) return null;
  const rounded = Number(formatNumber(Math.abs(meanDelta), decimals).replace(/,/g, ""));
  if (rounded === 0) return "Same mean as before";
  const amount = valueWithUnit(Math.abs(meanDelta), unit, decimals, label);
  return `Mean ${amount} ${meanDelta > 0 ? "higher" : "lower"} than before`;
};

const windowDays = (window: Readonly<{ start: string; end: string }>): string =>
  `${dayOf(window.start)} – ${dayOf(window.end)}`;

/** The comparison chart's text alternative: title, both windows, their n and mean. */
export const comparisonAlt = (title: string, spec: CompareSpec): string => {
  const decimals = compareDecimals(spec);
  const before = windowSummary(spec.before, spec.unit, decimals, spec.label);
  const after = windowSummary(spec.after, spec.unit, decimals, spec.label);
  const delta = deltaLine(spec.meanDelta, spec.unit, decimals, spec.label);
  return [
    `${title}.`,
    `Earlier window ${windowDays(spec.before)}: ${before}.`,
    `Later window ${windowDays(spec.after)}: ${after}.`,
    ...(delta === null ? [] : [`${delta}.`]),
  ].join(" ");
};

// --- biomarker card ------------------------------------------------------------

/** "latest, 3 Oct 2026 · 12 readings in the window". */
export const latestLine = (spec: BiomarkerCardSpec): string =>
  `latest, ${dayOf(spec.at)} · ${String(spec.n)} ${spec.n === 1 ? "reading" : "readings"} in the window`;

const listWords = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;

const FACT_WORDS: Readonly<Record<BiomarkerCardSpec["dependsOn"][number], string>> = {
  sex: "sex",
  age: "age",
  timing: "the time of the sample",
};

/** Where the value sits, in words. */
export const positionText = (spec: BiomarkerCardSpec): string => {
  if (spec.position === "within") return "Within the range";
  if (spec.position === "above") return "Above the range";
  if (spec.position === "below") return "Below the range";
  return spec.dependsOn.length > 0
    ? `The range depends on ${listWords(spec.dependsOn.map((fact) => FACT_WORDS[fact]))}, which the record lacks`
    : "No position";
};

/** "3.6–5.5 mmol/L (Anchor v3, adults)", "≤ 5.7% (…)", "≥ 3 ng/mL (…)". */
export const rangeText = (spec: BiomarkerCardSpec): string => {
  const range = spec.range;
  if (range === null) {
    return spec.dependsOn.length > 0
      ? `Depends on ${listWords(spec.dependsOn.map((fact) => FACT_WORDS[fact]))}`
      : "No published range";
  }
  const decimals = Math.max(
    range.low === null ? 0 : writtenDecimals(range.low),
    range.high === null ? 0 : writtenDecimals(range.high),
  );
  const unit = unitText(range.unit, spec.label);
  const num = (value: number): string => formatNumber(value, decimals);
  const bounds =
    range.low !== null && range.high !== null
      ? withUnit(`${num(range.low)}–${num(range.high)}`, unit)
      : range.high !== null
        ? `≤ ${withUnit(num(range.high), unit)}`
        : range.low !== null
          ? `≥ ${withUnit(num(range.low), unit)}`
          : "No bounds";
  return `${bounds} (${range.source}, ${range.population})`;
};

/** "↑ Rising · n = 12", "↓ Falling · n = 4", "→ Level · n = 5", or too few readings. */
export const trendText = (spec: BiomarkerCardSpec): string => {
  const n = `n = ${String(spec.trend.n)}`;
  switch (spec.trend.direction) {
    case "up":
      return `↑ Rising · ${n}`;
    case "down":
      return `↓ Falling · ${n}`;
    case "level":
      return `→ Level · ${n}`;
    default:
      return `No trend: too few readings · ${n}`;
  }
};

/** The latest value at the decimals it was written with. */
export const readoutText = (spec: BiomarkerCardSpec): string =>
  valueWithUnit(spec.value, spec.unit, writtenDecimals(spec.value), spec.label);

/**
 * Where the decorative bar draws the range and the marker, as percentages
 * of its width; null when there is no range to draw.
 */
export const rangeBar = (
  spec: BiomarkerCardSpec,
): Readonly<{ from: number; to: number; marker: number }> | null => {
  const range = spec.range;
  if (range === null || (range.low === null && range.high === null)) return null;
  const low = range.low ?? Math.min(0, spec.value);
  const high = range.high ?? Math.max(low * 2, spec.value);
  const span = high - low || Math.abs(high) || 1;
  const min = Math.min(low - span * 0.5, spec.value);
  const max = Math.max(high + span * 0.5, spec.value);
  const at = (value: number): number => ((value - min) / (max - min || 1)) * 100;
  return {
    from: range.low === null ? 0 : at(low),
    to: range.high === null ? 100 : at(high),
    marker: at(spec.value),
  };
};

// --- table ---------------------------------------------------------------------

export type TableCell = string | number | null;

/** The decimals a number column was written with, at most three. */
export const columnDecimals = (
  rows: readonly Readonly<Record<string, TableCell>>[],
  key: string,
): number =>
  rows.reduce((most, row) => {
    const value = row[key];
    return typeof value === "number" ? Math.max(most, writtenDecimals(value)) : most;
  }, 0);

/** One cell in words: dates as days, numbers at the column's decimals, missing as a dash. */
export const cellText = (
  value: TableCell | undefined,
  format: "date" | "number" | "text",
  decimals: number,
): string => {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (format === "date") return typeof value === "string" ? dayOf(value) : String(value);
  if (format === "number") {
    return typeof value === "number" ? formatNumber(value, decimals) : String(value);
  }
  return String(value);
};

/** "Showing first 50 of 120" when the table was cut; null when it was not. */
export const truncationLine = (shown: number, total: number): string | null =>
  total > shown ? `Showing first ${String(shown)} of ${String(total)}` : null;
