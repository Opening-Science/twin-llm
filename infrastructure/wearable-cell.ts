/**
 * Which source gave a number (#508). A cell is one stored wearable reading:
 * the source that recorded it, the measure, the day and the stored key. A
 * citation names a cell by its key; the number an answer states may hold the
 * value of another. This file finds, for a stated number, the cell or cells
 * whose value it is, and says how the cited cell and that cell differ. Pure,
 * so the chat, the thread export and the attribution study read a number the
 * same way.
 *
 * Matching is `statedMatchesReading` (`cited-value-check.ts`): a number
 * matches a cell when it states the value at the precision the app shows it
 * with, in any unit of the measure's dimension.
 *
 * A measure is the one the source rules compare (`COMPARABLE_STEMS`), so
 * Oura's and WHOOP's HRV are one measure; any other key is its own measure,
 * its stem without date or sleep period.
 */
import { statedMatchesReading } from "./cited-value-check";
import { formatMetricValue, metricStem } from "./format-measure";
import {
  metricDay,
  sourceOfMetricKey,
  type WearableSourceId,
} from "./wearable-provenance";
import { COMPARABLE_STEMS } from "./wearable-source-rules";

export type WearableCell = Readonly<{
  key: string;
  source: WearableSourceId;
  /** A `SourceMeasure` where the rules compare it, else the key's stem. */
  measure: string;
  /** `YYYY-MM-DD`; null when the reading carries no real day. */
  day: string | null;
  value: number;
  unit?: string;
  label: string;
}>;

/** The measure a stored key belongs to; WHOOP writes `unknown` for a missing day. */
export const measureOfKey = (key: string): string => {
  const stem = metricStem(key).replace(/\.unknown$/, "");
  return COMPARABLE_STEMS[stem] ?? stem;
};

/**
 * The cell a stored metric is, or null when its value is not a number. The
 * source is the metric's own, else the key's vendor prefix.
 */
export const cellOf = (
  metric: Readonly<{
    key: string;
    label: string;
    value: string | number;
    unit?: string;
    date?: string;
    source?: WearableSourceId;
  }>,
): WearableCell | null => {
  const value =
    typeof metric.value === "number"
      ? metric.value
      : /^-?\d+(?:\.\d+)?$/.test(metric.value.trim())
        ? Number(metric.value)
        : Number.NaN;
  if (!Number.isFinite(value)) return null;
  return {
    key: metric.key,
    source: metric.source ?? sourceOfMetricKey(metric.key),
    measure: measureOfKey(metric.key),
    day: metricDay(metric),
    value,
    ...(metric.unit === undefined ? {} : { unit: metric.unit }),
    label: metric.label,
  };
};

export const cellsOf = (
  metrics: readonly Parameters<typeof cellOf>[0][],
): readonly WearableCell[] =>
  metrics.flatMap((metric) => {
    const cell = cellOf(metric);
    return cell === null ? [] : [cell];
  });

const statesCell = (stated: string, cell: WearableCell): boolean =>
  statedMatchesReading(stated, {
    key: cell.key,
    label: cell.label,
    value: cell.value,
    ...(cell.unit === undefined ? {} : { unit: cell.unit }),
  });

export type Trace =
  | Readonly<{ kind: "one"; cell: WearableCell }>
  | Readonly<{ kind: "several"; cells: readonly WearableCell[] }>
  | Readonly<{ kind: "none" }>;

/** The cells of `measure` whose value `stated` is. */
export const traceStated = (
  stated: string,
  measure: string,
  cells: readonly WearableCell[],
): Trace => {
  const hits = cells.filter(
    (cell) => cell.measure === measure && statesCell(stated, cell),
  );
  const [first] = hits;
  if (first === undefined) return { kind: "none" };
  return hits.length === 1
    ? { kind: "one", cell: first }
    : { kind: "several", cells: hits };
};

/**
 * How a cited cell stands to the cell the stated number traced to.
 * `correct`: the same source, measure and day. Otherwise each part that
 * differs, in that order of weight: a wrong measure says nothing about the
 * source, so it is reported alone. `untraced`: the number is no cell's value;
 * `ambiguous`: it is the value of more than one, so the cell is not known.
 */
export const CITATION_VERDICTS = [
  "correct",
  "wrong_source",
  "wrong_day",
  "wrong_source_and_day",
  "wrong_measure",
  "untraced",
  "ambiguous",
] as const;

export type CitationVerdict = (typeof CITATION_VERDICTS)[number];

export const citationVerdict = (
  cited: Pick<WearableCell, "source" | "measure" | "day">,
  trace: Trace,
): CitationVerdict => {
  if (trace.kind === "none") return "untraced";
  if (trace.kind === "several") return "ambiguous";
  const { cell } = trace;
  if (cell.measure !== cited.measure) return "wrong_measure";
  const source = cell.source === cited.source;
  const day = cell.day === cited.day;
  if (source && day) return "correct";
  if (!source && !day) return "wrong_source_and_day";
  return source ? "wrong_day" : "wrong_source";
};

/**
 * Pairs of cells of one measure that one stated number could stand for: the
 * value of one, as the app shows it, states the other. Empty when every number
 * the app could show traces to at most one cell, the study's identifiability
 * condition (P6, section 4.1). Each pair once, in input order.
 */
export const confusableCells = (
  cells: readonly WearableCell[],
): readonly (readonly [WearableCell, WearableCell])[] =>
  cells.flatMap((a, index) =>
    cells
      .slice(index + 1)
      .filter(
        (b) =>
          a.measure === b.measure &&
          (statesCell(formatMetricValue(a), b) || statesCell(formatMetricValue(b), a)),
      )
      .map((b) => [a, b] as const),
  );

/** The verdicts that name another reading the number is: its source, its day, or both. */
export const MISCITED_VERDICTS = [
  "wrong_source",
  "wrong_day",
  "wrong_source_and_day",
] as const;

export type MiscitedVerdict = (typeof MISCITED_VERDICTS)[number];

/**
 * The reading a stated number is, when it is not the cited one but another
 * reading of the same measure the answer was offered (#508).
 */
export type StatedFrom = Readonly<{
  source: WearableSourceId;
  /** Absent when that reading carries no real day. */
  day?: string;
  verdict: MiscitedVerdict;
}>;

export const isMiscitedVerdict = (verdict: unknown): verdict is MiscitedVerdict =>
  (MISCITED_VERDICTS as readonly unknown[]).includes(verdict);

const DAY_MS = 86_400_000;

/**
 * Whether two readings' days are the same or next to each other. Readings
 * with no real day are only near each other.
 */
const nearDay = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) return a === b;
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= DAY_MS;
};

/**
 * Where `stated` came from, for a cited reading it does not match: the one
 * other offered reading of its measure, on the cited day or a neighbouring
 * one, whose value it is. A match further off could be coincidence among the
 * many readings offered, so it is not named. Null when it is none of them,
 * more than one, or the cited reading is not a number.
 */
export const statedFrom = (
  cited: Parameters<typeof cellOf>[0],
  stated: string,
  offered: readonly WearableCell[],
): StatedFrom | null => {
  const cell = cellOf(cited);
  if (cell === null) return null;
  const trace = traceStated(
    stated,
    cell.measure,
    offered.filter((other) => other.key !== cell.key && nearDay(other.day, cell.day)),
  );
  const verdict = citationVerdict(cell, trace);
  if (trace.kind !== "one" || !isMiscitedVerdict(verdict)) return null;
  return {
    source: trace.cell.source,
    ...(trace.cell.day === null ? {} : { day: trace.cell.day }),
    verdict,
  };
};
