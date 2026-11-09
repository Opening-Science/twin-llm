/**
 * Geometry for the chart kit: pure numbers and path strings, no DOM, so the
 * components only draw and the wearables and Lab screens can reuse the maths.
 *
 * Every function takes the box it draws in (real pixels, measured by the
 * component) and returns positions inside it. Missing values keep their slot
 * and draw nothing, so days stay aligned.
 */

import { niceTicks } from "../chart-geometry";

export type Box = Readonly<{ width: number; height: number }>;
export type Bar = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;

/** Rounded for the path string only; this is geometry, not display text. */
const coord = (value: number): string => String(Math.round(value * 10) / 10);

const finite = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

const linePath = (points: readonly Point[]): string =>
  points.map((p, i) => `${i === 0 ? "M" : "L"}${coord(p.x)},${coord(p.y)}`).join(" ");

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/* --- C05 cumulative day line ------------------------------------------------ */

/** A value at a time of day, `at` from 0 (midnight) to 1 (the next midnight). */
export type DaySample = Readonly<{
  at: number;
  value: number;
  /** What the readout says when this point is focused, e.g. "2 PM · 3,140 steps". */
  readout?: string;
}>;

export type CumulativeDay = Readonly<{
  /** The reference curve up to now, grey. */
  averagePast: string;
  /** The reference curve after now, in the track tone: the future is faded. */
  averageFuture: string;
  /** Today up to now, in the category colour. */
  today: string;
  /** Where today ends; null when there is no today yet. */
  now: Point | null;
  nowX: number;
  /** Today's samples up to now in time order, and where each is drawn. */
  samples: readonly DaySample[];
  points: readonly Point[];
}>;

/** Today's samples up to `now`, in time order: the points a chart can focus. */
export const samplesUpTo = (
  today: readonly DaySample[],
  now: number,
): readonly DaySample[] =>
  [...today]
    .filter((s) => finite(s.value) && s.at <= clamp01(now))
    .sort((a, b) => a.at - b.at);

/**
 * Today's running total against the usual running total, on one scale (the
 * larger of the two), with the reference split at `now` (0 to 1).
 */
export const cumulativeDay = (
  today: readonly DaySample[],
  average: readonly DaySample[],
  now: number,
  box: Box,
): CumulativeDay => {
  const values = [...today, ...average].map((s) => s.value).filter(finite);
  const max = Math.max(1, ...values);
  const at = (s: DaySample): Point => ({
    x: clamp01(s.at) * box.width,
    y: box.height - (Math.max(0, s.value) / max) * box.height,
  });
  const cut = clamp01(now);
  const sorted = [...average].filter((s) => finite(s.value)).sort((a, b) => a.at - b.at);
  // The point on the reference at exactly `now`, so both halves meet.
  const valueAtNow = (() => {
    const after = sorted.findIndex((s) => s.at >= cut);
    if (after <= 0) return sorted[0]?.value ?? 0;
    const a = sorted[after - 1]!;
    const b = sorted[after]!;
    const share = b.at === a.at ? 0 : (cut - a.at) / (b.at - a.at);
    return a.value + share * (b.value - a.value);
  })();
  const join = { at: cut, value: valueAtNow };
  const past = [...sorted.filter((s) => s.at < cut), join];
  const future = [join, ...sorted.filter((s) => s.at > cut)];
  const samples = samplesUpTo(today, cut);
  const todayPoints = samples.map(at);
  return {
    averagePast: sorted.length < 1 ? "" : linePath(past.map(at)),
    averageFuture: sorted.length < 1 || cut >= 1 ? "" : linePath(future.map(at)),
    today: todayPoints.length < 2 ? "" : linePath(todayPoints),
    now: todayPoints.at(-1) ?? null,
    nowX: cut * box.width,
    samples,
    points: todayPoints,
  };
};

/* --- C06 weekly bars, C13 consistency bars ---------------------------------- */

export type BarsWithLine = Readonly<{
  bars: readonly (Bar | null)[];
  /** Slot centres, for the weekday letters under each bar. */
  centres: readonly number[];
  /** The average or target line's height; null when there is none. */
  lineY: number | null;
  /** The usual range as a band, top and bottom; null when there is none. */
  band: Readonly<{ top: number; bottom: number }> | null;
}>;

export type BarScale = Readonly<{
  /**
   * Where bars start, instead of zero: a bedtime near 23:00 is about 1,380
   * minutes, so from zero a 30-minute shift is invisible. A bar at or below
   * the floor is a 2px stub, so the day still shows.
   */
  floor?: number;
  /** The usual range, drawn as a band behind the bars. */
  band?: Readonly<{ low: number; high: number }>;
}>;

/**
 * Bars from the floor (zero unless given) up to each value, and a
 * reference line (an average or a target) and a usual band, all on one
 * scale so nothing is drawn off the chart. Bars are at most `maxBar` wide
 * and centred in their slot.
 */
export const barsWithLine = (
  values: readonly (number | null)[],
  line: number | null,
  box: Box,
  maxBar = 28,
  gap = 6,
  scale: BarScale = {},
): BarsWithLine => {
  const floor = scale.floor ?? 0;
  const band =
    scale.band && finite(scale.band.low) && finite(scale.band.high) ? scale.band : null;
  const present = values
    .filter(finite)
    .filter((v) => (scale.floor === undefined ? v > 0 : true));
  const top = Math.max(
    ...present,
    finite(line) ? line : floor,
    band ? Math.max(band.low, band.high) : floor,
    floor,
  );
  const span = top - floor;
  // All at the floor still draws stubs; without a floor, nothing to draw.
  const scaleSpan = span > 0 ? span : 1;
  const y = (v: number): number =>
    box.height - (Math.max(0, v - floor) / scaleSpan) * box.height;
  const slot = values.length === 0 ? 0 : box.width / values.length;
  const width = Math.max(2, Math.min(maxBar, slot - gap));
  const centres = values.map((_, i) => i * slot + slot / 2);
  const bars = values.map((value, i) => {
    if (!finite(value)) return null;
    if (scale.floor === undefined && (value <= 0 || span <= 0)) return null;
    const height = Math.max(2, box.height - y(value));
    return { x: centres[i]! - width / 2, y: box.height - height, width, height };
  });
  return {
    bars,
    centres,
    lineY: finite(line) && span > 0 ? y(line) : null,
    band:
      band && span > 0
        ? {
            top: y(Math.max(band.low, band.high)),
            bottom: y(Math.min(band.low, band.high)),
          }
        : null,
  };
};

/* --- C07 streak grid --------------------------------------------------------- */

export type StreakDay = Readonly<{
  date: string;
  done: boolean;
  /** What the readout says when this day is focused. */
  readout?: string;
}>;

export type StreakCell = Readonly<{
  date: string;
  day: number;
  done: boolean;
  today: boolean;
  row: number;
  col: number;
  /** "OCT" on the first cell and on the first of each month. */
  month: string | null;
  readout?: string;
}>;

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const parseDay = (date: string): Date => new Date(`${date}T00:00:00Z`);

/**
 * Days placed on a 7-column grid starting on `weekStart` (0 Sunday, 1
 * Monday). Dates are calendar days (YYYY-MM-DD), read in UTC so a time zone
 * never moves a day to the next cell.
 */
export const streakGrid = (
  days: readonly StreakDay[],
  today: string,
  weekStart: 0 | 1 = 1,
): readonly StreakCell[] => {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  if (!first) return [];
  const origin = parseDay(first.date);
  const lead = (origin.getUTCDay() - weekStart + 7) % 7;
  return sorted.map((d, i) => {
    const when = parseDay(d.date);
    const offset = Math.round((when.getTime() - origin.getTime()) / 86_400_000) + lead;
    const day = when.getUTCDate();
    return {
      date: d.date,
      day,
      done: d.done,
      today: d.date === today,
      row: Math.floor(offset / 7),
      col: offset % 7,
      month: i === 0 || day === 1 ? MONTHS[when.getUTCMonth()]! : null,
      readout: d.readout,
    };
  });
};

/** Weekday letters from the week start: M T W T F S S or S M T W T F S. */
export const weekdayLetters = (weekStart: 0 | 1 = 1): readonly string[] => {
  const sunday = ["S", "M", "T", "W", "T", "F", "S"];
  return [...sunday.slice(weekStart), ...sunday.slice(0, weekStart)];
};

/* --- C08 range bars ---------------------------------------------------------- */

export type Range = Readonly<{
  min: number;
  max: number;
  /** What the readout says when this bucket is focused. */
  readout?: string;
}>;

export type RangeBars = Readonly<{
  bars: readonly (Bar | null)[];
  /** The bucket holding the lowest minimum and the highest maximum. */
  lowest: number;
  highest: number;
  min: number;
  max: number;
}>;

/**
 * One rounded bar from each bucket's minimum to its maximum, scaled to the
 * lowest and highest values across buckets. A bar is never shorter than its
 * width, so a flat bucket still reads as a pill.
 */
export const rangeBars = (
  buckets: readonly (Range | null)[],
  box: Box,
  maxBar = 14,
  gap = 4,
): RangeBars => {
  const present = buckets.flatMap((b, i) =>
    b && finite(b.min) && finite(b.max) ? [{ ...b, i }] : [],
  );
  const empty = {
    bars: buckets.map(() => null),
    lowest: -1,
    highest: -1,
    min: 0,
    max: 0,
  };
  if (present.length === 0) return empty;
  const lowestBucket = present.reduce((a, b) => (b.min < a.min ? b : a));
  const highestBucket = present.reduce((a, b) => (b.max > a.max ? b : a));
  const lo = lowestBucket.min;
  const hi = highestBucket.max;
  const span = hi - lo || 1;
  const slot = box.width / buckets.length;
  const width = Math.max(2, Math.min(maxBar, slot - gap));
  const y = (v: number): number => box.height - ((v - lo) / span) * box.height;
  const bars = buckets.map((b, i) => {
    if (!b || !finite(b.min) || !finite(b.max)) return null;
    const top = y(Math.max(b.min, b.max));
    const bottom = y(Math.min(b.min, b.max));
    const height = Math.max(width, bottom - top);
    const centre = (top + bottom) / 2;
    return {
      x: i * slot + (slot - width) / 2,
      y: Math.min(box.height - height, Math.max(0, centre - height / 2)),
      width,
      height,
    };
  });
  return { bars, lowest: lowestBucket.i, highest: highestBucket.i, min: lo, max: hi };
};

/* --- C09 hypnogram ----------------------------------------------------------- */

export type SleepStage = "awake" | "rem" | "core" | "deep";

/** Lanes top to bottom, as the board draws them. */
export const STAGE_LANES: readonly SleepStage[] = ["awake", "rem", "core", "deep"];

export type StageSpan = Readonly<{
  stage: SleepStage;
  start: number;
  end: number;
  /** What the readout says when this block is focused. */
  readout?: string;
}>;

export type Hypnogram = Readonly<{
  /** In time order, each with its span's readout. */
  blocks: readonly (Bar & { stage: SleepStage; readout?: string })[];
  /** Thin verticals where one stage hands over to the next. */
  steps: string;
  laneY: Readonly<Record<SleepStage, number>>;
  laneHeight: number;
  /** Minutes per stage, whatever order the spans came in. */
  minutes: Readonly<Record<SleepStage, number>>;
}>;

/**
 * Stage spans (start and end in minutes, or any one unit) drawn as blocks
 * on four lanes across the night, joined by steps.
 */
export const hypnogram = (spans: readonly StageSpan[], box: Box, gap = 6): Hypnogram => {
  const laneHeight = (box.height - gap * (STAGE_LANES.length - 1)) / STAGE_LANES.length;
  const laneY = Object.fromEntries(
    STAGE_LANES.map((s, i) => [s, i * (laneHeight + gap)]),
  ) as Record<SleepStage, number>;
  const valid = [...spans]
    .filter((s) => finite(s.start) && finite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const minutes = Object.fromEntries(
    STAGE_LANES.map((stage) => [
      stage,
      valid.filter((s) => s.stage === stage).reduce((sum, s) => sum + s.end - s.start, 0),
    ]),
  ) as Record<SleepStage, number>;
  const start = valid[0]?.start ?? 0;
  const span = (valid.at(-1)?.end ?? 0) - start || 1;
  const x = (t: number): number => ((t - start) / span) * box.width;
  const blocks = valid.map((s) => ({
    stage: s.stage,
    readout: s.readout,
    x: x(s.start),
    y: laneY[s.stage],
    width: Math.max(1, x(s.end) - x(s.start)),
    height: laneHeight,
  }));
  const steps = valid
    .slice(1)
    .map((s, i) => {
      const prev = valid[i]!;
      const a = laneY[prev.stage] + laneHeight / 2;
      const b = laneY[s.stage] + laneHeight / 2;
      return `M${coord(x(s.start))},${coord(a)} L${coord(x(s.start))},${coord(b)}`;
    })
    .join(" ");
  return { blocks, steps, laneY, laneHeight, minutes };
};

/* --- C10 score ring ---------------------------------------------------------- */

export type RingPart = Readonly<{
  value: number;
  max: number;
  /** What the readout says when this part is focused. */
  readout?: string;
}>;

export type RingArc = Readonly<{ track: string; value: string }>;

const polar = (cx: number, cy: number, r: number, angle: number): Point => ({
  x: cx + r * Math.sin(angle),
  y: cy - r * Math.cos(angle),
});

const arc = (cx: number, cy: number, r: number, from: number, to: number): string => {
  if (to - from <= 1e-6) return "";
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M${coord(a.x)},${coord(a.y)} A${coord(r)},${coord(r)} 0 ${large} 1 ${coord(b.x)},${coord(b.y)}`;
};

/**
 * A segmented ring: each part takes a share of the circle by its maximum,
 * clockwise from the top, with `gap` pixels between parts (measured on the
 * centre line, so it holds with round caps of half the stroke on each end).
 */
export const scoreRing = (
  parts: readonly RingPart[],
  size: number,
  stroke = 18,
  gap = 8,
): Readonly<{ arcs: readonly RingArc[]; score: number }> => {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.max), 0);
  if (total === 0 || r <= 0)
    return { arcs: parts.map(() => ({ track: "", value: "" })), score: 0 };
  // Round caps reach half a stroke past each end, so the gap includes them.
  const gapAngle = parts.length > 1 ? (gap + stroke) / r : 0;
  const usable = Math.max(0, 2 * Math.PI - gapAngle * parts.length);
  let cursor = gapAngle / 2;
  const arcs = parts.map((p) => {
    const sweep = (Math.max(0, p.max) / total) * usable;
    const filled = p.max > 0 ? clamp01(p.value / p.max) * sweep : 0;
    const out = {
      track: arc(c, c, r, cursor, cursor + sweep),
      value: arc(c, c, r, cursor, cursor + filled),
    };
    cursor += sweep + gapAngle;
    return out;
  });
  const got = parts.reduce(
    (sum, p) => sum + Math.min(Math.max(0, p.value), Math.max(0, p.max)),
    0,
  );
  return { arcs, score: Math.round((got / total) * 100) };
};

/* --- C12 month comparison ---------------------------------------------------- */

/** Each bar's share of the card width, scaled to the larger of the two. */
export const monthShares = (
  current: number | null,
  previous: number | null,
): Readonly<{ current: number; previous: number }> => {
  const top = Math.max(finite(current) ? current : 0, finite(previous) ? previous : 0);
  const share = (v: number | null): number =>
    finite(v) && top > 0 ? clamp01(v / top) : 0;
  return { current: share(current), previous: share(previous) };
};

/* --- R1 research figures ----------------------------------------------------- */

export type Estimate = Readonly<{
  label: string;
  estimate: number;
  low?: number | null;
  high?: number | null;
  /** What the readout says when this row is focused. */
  readout?: string;
  /** A group this row belongs to, e.g. "qwen3:4b"; rows of one series share a colour. */
  series?: string;
  /** An expected value for this row, drawn as a grey tick on it. */
  expected?: number | null;
}>;

export type EstimateRow = Readonly<{
  label: string;
  x: number;
  low: number | null;
  high: number | null;
  expected: number | null;
  y: number;
  /** Index into `series`, or null for a row without one. */
  series: number | null;
}>;

export type EstimateRows = Readonly<{
  rows: readonly EstimateRow[];
  ticks: readonly Readonly<{ value: number; x: number }>[];
  /** Where the reference (a null, a control, an expected value) sits. */
  referenceX: number | null;
  /** The distinct series keys, in the order rows first name them. */
  series: readonly string[];
}>;

export type AxisScale = "linear" | "log";

/**
 * Even ticks for a ratio on a log axis: powers of two that cover [min, max],
 * such as 0.5, 1, 2, 4, 8. Values at or below zero have no place on it.
 */
export const log2Ticks = (min: number, max: number): readonly number[] => {
  if (!(min > 0) || !(max > 0)) return [1];
  const low = Math.floor(Math.log2(Math.min(min, max)));
  const high = Math.ceil(Math.log2(Math.max(min, max)));
  const top = high === low ? low + 1 : high;
  return Array.from({ length: top - low + 1 }, (_, i) => 2 ** (low + i));
};

/**
 * Point estimates with interval whiskers, one row each, on a shared axis
 * with ticks that cover every interval, expected value and the reference.
 * On a log axis (for ratios) the ticks are powers of two and values at or
 * below zero are left off. `pad` keeps a dot at either end clear of the
 * plot's edge, so a value of 0 never sits on its row's label.
 */
export const estimateRows = (
  estimates: readonly Estimate[],
  box: Box,
  reference: number | null = null,
  domain?: readonly [number, number],
  scale: AxisScale = "linear",
  pad = 0,
): EstimateRows => {
  const values = estimates
    .flatMap((e) => [e.estimate, e.low, e.high, e.expected])
    .filter(finite)
    .filter((v) => scale === "linear" || v > 0);
  if (finite(reference) && (scale === "linear" || reference > 0)) values.push(reference);
  const lowest = domain?.[0] ?? Math.min(...values);
  const highest = domain?.[1] ?? Math.max(...values);
  const ticks =
    scale === "log"
      ? values.length === 0
        ? [1, 2]
        : log2Ticks(lowest, highest)
      : domain
        ? niceTicks(domain[0], domain[1])
        : values.length === 0
          ? [0, 1]
          : niceTicks(lowest, highest);
  const lo = domain?.[0] ?? ticks[0]!;
  const hi = domain?.[1] ?? ticks.at(-1)!;
  const at = (v: number): number => (scale === "log" ? Math.log2(v) : v);
  const span = at(hi) - at(lo) || 1;
  const inner = Math.max(1, box.width - 2 * pad);
  const place = (v: number | null | undefined): number | null =>
    finite(v) && (scale === "linear" || v > 0)
      ? pad + ((at(v) - at(lo)) / span) * inner
      : null;
  const slot = estimates.length === 0 ? 0 : box.height / estimates.length;
  const series = [...new Set(estimates.flatMap((e) => (e.series ? [e.series] : [])))];
  return {
    rows: estimates.map((e, i) => ({
      label: e.label,
      x: place(e.estimate) ?? pad,
      low: place(e.low),
      high: place(e.high),
      expected: place(e.expected),
      y: i * slot + slot / 2,
      series: e.series ? series.indexOf(e.series) : null,
    })),
    ticks: ticks
      .filter((t) => t >= lo && t <= hi)
      .map((value) => ({ value, x: place(value)! })),
    referenceX: place(reference),
    series,
  };
};

export type NullFigure = Readonly<{
  bars: readonly Bar[];
  observedX: number;
  /** The share of the null at or beyond the observed value, 0 to 1. */
  atOrBeyond: number;
}>;

/** A null distribution given as its summary rather than its draws. */
export type NullSummary = Readonly<{
  mean: number;
  low: number;
  high: number;
  runs: number;
}>;

export type NullBand = Readonly<{
  /** The null's interval as a band, and its mean as a tick. */
  low: number;
  high: number;
  mean: number;
  observedX: number;
}>;

/**
 * A null given as a summary: its interval and mean, and the observed
 * value, on one axis covering all of them with a little room either side.
 */
export const nullBand = (
  summary: NullSummary,
  observed: number,
  box: Box,
  pad = 8,
): NullBand => {
  const lo = Math.min(summary.low, summary.mean, observed);
  const hi = Math.max(summary.high, summary.mean, observed);
  const span = hi - lo || 1;
  const inner = Math.max(1, box.width - 2 * pad);
  const x = (v: number): number => pad + ((v - lo) / span) * inner;
  return {
    low: x(Math.min(summary.low, summary.high)),
    high: x(Math.max(summary.low, summary.high)),
    mean: x(summary.mean),
    observedX: x(observed),
  };
};

/**
 * A null distribution as a histogram of `bins` bars, and the observed value
 * as a position on the same axis.
 */
export const nullFigure = (
  draws: readonly number[],
  observed: number,
  box: Box,
  bins = 24,
): NullFigure => {
  const values = draws.filter(finite);
  if (values.length === 0) return { bars: [], observedX: box.width / 2, atOrBeyond: 0 };
  const lo = Math.min(...values, observed);
  const hi = Math.max(...values, observed);
  const span = hi - lo || 1;
  const width = box.width / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values)
    counts[Math.min(bins - 1, Math.floor(((v - lo) / span) * bins))]! += 1;
  const top = Math.max(...counts);
  return {
    bars: counts.map((n, i) => {
      const height = top === 0 ? 0 : (n / top) * box.height;
      return {
        x: i * width,
        y: box.height - height,
        width: Math.max(1, width - 1),
        height,
      };
    }),
    observedX: ((observed - lo) / span) * box.width,
    atOrBeyond: values.filter((v) => v >= observed).length / values.length,
  };
};

/**
 * The fewest decimals (at most 4) that write every value exactly, so a
 * quarter step reads 0.25, not 0.3.
 */
export const exactDecimals = (values: readonly number[]): number =>
  [0, 1, 2, 3, 4].find((d) =>
    values.every((v) => Math.abs(Number(v.toFixed(d)) - v) < 1e-9),
  ) ?? 4;

/* --- C18 radar --------------------------------------------------------------- */

/** One axis of a radar: its own 0 to `max`, since the parts have different units. */
export type RadarAxis = Readonly<{
  label: string;
  value: number | null;
  /** The value written beside the label, formatted by the screen. */
  display: string;
  reference?: number | null;
  max: number;
  /** What the readout says when this axis is focused. */
  readout?: string;
}>;

export type RadarAnchor = Readonly<{
  x: number;
  y: number;
  /** SVG text-anchor for the label, so it grows away from the chart. */
  align: "start" | "middle" | "end";
  /** Whether the two label lines sit above the anchor (top axes) or below. */
  above: boolean;
}>;

export type Radar = Readonly<{
  centre: Point;
  radius: number;
  /** Guide polygons at a third, two thirds and the full radius. */
  rings: readonly string[];
  spokes: readonly Point[];
  /** Today's polygon and its vertices; a missing value sits at the centre. */
  value: string;
  points: readonly Point[];
  /** The reference polygon; empty when no axis has a reference. */
  reference: string;
  anchors: readonly RadarAnchor[];
}>;

const closed = (points: readonly Point[]): string =>
  points.length === 0 ? "" : `${linePath(points)} Z`;

/**
 * A radar of three or more axes, clockwise from the top. The radius is what
 * is left of the box after `room` for the labels on each side, so on a
 * narrow screen the chart shrinks before its words do. Values are clamped
 * to their axis.
 */
export const radar = (
  axes: readonly RadarAxis[],
  box: Box,
  room: Readonly<{ x: number; y: number }> = { x: 84, y: 36 },
  gap = 10,
): Radar => {
  const centre = { x: box.width / 2, y: box.height / 2 };
  const radius = Math.max(
    24,
    Math.min((box.width - 2 * room.x) / 2, (box.height - 2 * room.y) / 2),
  );
  const n = axes.length;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i: number, share: number): Point => ({
    x: centre.x + Math.cos(angle(i)) * radius * share,
    y: centre.y + Math.sin(angle(i)) * radius * share,
  });
  const share = (v: number | null | undefined, max: number): number =>
    finite(v) && max > 0 ? clamp01(v / max) : 0;
  if (n < 3) {
    return {
      centre,
      radius,
      rings: [],
      spokes: [],
      value: "",
      points: [],
      reference: "",
      anchors: [],
    };
  }
  const points = axes.map((a, i) => at(i, share(a.value, a.max)));
  const hasReference = axes.some((a) => finite(a.reference));
  return {
    centre,
    radius,
    rings: [1 / 3, 2 / 3, 1].map((s) => closed(axes.map((_, i) => at(i, s)))),
    spokes: axes.map((_, i) => at(i, 1)),
    value: closed(points),
    points,
    reference: hasReference
      ? closed(axes.map((a, i) => at(i, share(a.reference, a.max))))
      : "",
    anchors: axes.map((_, i) => {
      const cos = Math.cos(angle(i));
      const sin = Math.sin(angle(i));
      return {
        x: centre.x + cos * (radius + gap),
        y: centre.y + sin * (radius + gap),
        align: Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end",
        above: sin < -0.3,
      };
    }),
  };
};

/**
 * Every k-th tick, so neighbours sit at least `minGap` pixels apart. The
 * first is always kept; ticks are evenly spaced, so the rest follow.
 */
export const spacedTicks = <T extends Readonly<{ x: number }>>(
  ticks: readonly T[],
  minGap = 36,
): readonly T[] => {
  if (ticks.length < 3) return ticks;
  const gap = Math.abs(ticks[1]!.x - ticks[0]!.x);
  const step = gap >= minGap || gap === 0 ? 1 : Math.ceil(minGap / gap);
  return ticks.filter((_, i) => i % step === 0);
};

export type EstimateLayout = Readonly<{
  /** Labels on their own line above each row, the plot at full width. */
  stacked: boolean;
  /** Where the plot starts and how wide it is. */
  left: number;
  plot: number;
  /** Height of one row. */
  row: number;
}>;

/**
 * Labels beside the plot while it keeps at least `minPlot` pixels; in a
 * narrower card each label moves above its row so the plot keeps the width.
 */
export const estimateLayout = (
  width: number,
  labels = 176,
  minPlot = 200,
  pad = 12,
): EstimateLayout =>
  width - labels - pad >= minPlot
    ? { stacked: false, left: labels, plot: width - labels - pad, row: 32 }
    : { stacked: true, left: pad, plot: Math.max(60, width - 2 * pad), row: 48 };

/**
 * How to anchor a label at `x` on a plot `width` wide so it stays inside:
 * from its start near the left edge, from its end near the right, centred
 * otherwise. `margin` is about half the widest label.
 */
export const edgeAnchor = (
  x: number,
  width: number,
  margin = 48,
): "start" | "middle" | "end" =>
  x < margin ? "start" : x > width - margin ? "end" : "middle";

/* --- Focus: which point a key or a pointer lands on -------------------------- */

export type KeyStep = Readonly<
  { kind: "move"; index: number } | { kind: "clear" } | { kind: "ignore" }
>;

/** Which arrow keys step: across (Left/Right), down (Up/Down) or either. */
export type StepAxis = "x" | "y" | "both";

const PREVIOUS: Readonly<Record<StepAxis, readonly string[]>> = {
  x: ["ArrowLeft"],
  y: ["ArrowUp"],
  both: ["ArrowLeft", "ArrowUp"],
};
const NEXT: Readonly<Record<StepAxis, readonly string[]>> = {
  x: ["ArrowRight"],
  y: ["ArrowDown"],
  both: ["ArrowRight", "ArrowDown"],
};

/**
 * What a key does to the focused point: arrows step one point and stop at
 * the ends, Home and End jump, Escape clears. From no focus, "next" lands
 * on the first point and "previous" on the last.
 */
export const stepKey = (
  key: string,
  current: number | null,
  count: number,
  axis: StepAxis = "x",
): KeyStep => {
  if (count <= 0) return { kind: "ignore" };
  if (key === "Escape") return current === null ? { kind: "ignore" } : { kind: "clear" };
  if (key === "Home") return { kind: "move", index: 0 };
  if (key === "End") return { kind: "move", index: count - 1 };
  if (NEXT[axis].includes(key)) {
    return {
      kind: "move",
      index: current === null ? 0 : Math.min(count - 1, current + 1),
    };
  }
  if (PREVIOUS[axis].includes(key)) {
    return {
      kind: "move",
      index: current === null ? count - 1 : Math.max(0, current - 1),
    };
  }
  return { kind: "ignore" };
};

/** The slot under `x` when `count` slots share `width` evenly; null outside. */
export const slotIndex = (x: number, width: number, count: number): number | null => {
  if (count <= 0 || width <= 0 || x < 0 || x > width) return null;
  return Math.min(count - 1, Math.floor((x / width) * count));
};

/**
 * The radar axis nearest a pointer at (dx, dy) from the centre, with `n`
 * axes clockwise from the top. Null at the very centre, where no direction
 * is meant.
 */
export const radarAxisAt = (
  dx: number,
  dy: number,
  n: number,
  dead = 4,
): number | null => {
  if (n < 1 || Math.hypot(dx, dy) < dead) return null;
  // Clockwise from the top, 0 to 2π.
  const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(angle / ((2 * Math.PI) / n)) % n;
};

/**
 * The ring part in the direction of a pointer at (dx, dy) from the centre:
 * parts run clockwise from the top, each as wide as its share of the
 * maximum (the small gaps are left out). Null at the very centre.
 */
export const ringPartAt = (
  dx: number,
  dy: number,
  parts: readonly RingPart[],
  dead = 4,
): number | null => {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.max), 0);
  if (total === 0 || Math.hypot(dx, dy) < dead) return null;
  const turn = ((Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  let edge = 0;
  for (const [i, p] of parts.entries()) {
    edge += Math.max(0, p.max) / total;
    if (turn < edge) return i;
  }
  return parts.length - 1;
};

/**
 * Stage totals as bar widths on one scale, the longest stage at full width,
 * for a source that reports totals but not the night's order (WHOOP).
 * Missing or negative totals are 0.
 */
export const stageTotalWidths = (
  totals: Readonly<Partial<Record<SleepStage, number>>>,
  width: number,
): Readonly<Record<SleepStage, number>> => {
  const minutes = (stage: SleepStage): number => {
    const v = totals[stage];
    return finite(v) && v > 0 ? v : 0;
  };
  const longest = Math.max(0, ...STAGE_LANES.map(minutes));
  return Object.fromEntries(
    STAGE_LANES.map((stage) => [
      stage,
      longest === 0 ? 0 : (minutes(stage) / longest) * width,
    ]),
  ) as Record<SleepStage, number>;
};
