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
export type DaySample = Readonly<{ at: number; value: number }>;

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
}>;

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
  const todayPoints = [...today]
    .filter((s) => finite(s.value) && s.at <= cut)
    .sort((a, b) => a.at - b.at)
    .map(at);
  return {
    averagePast: sorted.length < 1 ? "" : linePath(past.map(at)),
    averageFuture: sorted.length < 1 || cut >= 1 ? "" : linePath(future.map(at)),
    today: todayPoints.length < 2 ? "" : linePath(todayPoints),
    now: todayPoints.at(-1) ?? null,
    nowX: cut * box.width,
  };
};

/* --- C06 weekly bars, C13 consistency bars ---------------------------------- */

export type BarsWithLine = Readonly<{
  bars: readonly (Bar | null)[];
  /** Slot centres, for the weekday letters under each bar. */
  centres: readonly number[];
  /** The average or target line's height; null when there is none. */
  lineY: number | null;
}>;

/**
 * Bars from zero up to each value, and a reference line (an average or a
 * target), on one scale so the line is never drawn off the chart. Bars are
 * at most `maxBar` wide and centred in their slot.
 */
export const barsWithLine = (
  values: readonly (number | null)[],
  line: number | null,
  box: Box,
  maxBar = 28,
  gap = 6,
): BarsWithLine => {
  const present = values.filter(finite).filter((v) => v > 0);
  const top = Math.max(...present, finite(line) ? line : 0, 0);
  const slot = values.length === 0 ? 0 : box.width / values.length;
  const width = Math.max(2, Math.min(maxBar, slot - gap));
  const centres = values.map((_, i) => i * slot + slot / 2);
  const bars = values.map((value, i) => {
    if (!finite(value) || value <= 0 || top === 0) return null;
    const height = (value / top) * box.height;
    return { x: centres[i]! - width / 2, y: box.height - height, width, height };
  });
  return {
    bars,
    centres,
    lineY: finite(line) && top > 0 ? box.height - (line / top) * box.height : null,
  };
};

/* --- C07 streak grid --------------------------------------------------------- */

export type StreakDay = Readonly<{ date: string; done: boolean }>;

export type StreakCell = Readonly<{
  date: string;
  day: number;
  done: boolean;
  today: boolean;
  row: number;
  col: number;
  /** "OCT" on the first cell and on the first of each month. */
  month: string | null;
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
    };
  });
};

/** Weekday letters from the week start: M T W T F S S or S M T W T F S. */
export const weekdayLetters = (weekStart: 0 | 1 = 1): readonly string[] => {
  const sunday = ["S", "M", "T", "W", "T", "F", "S"];
  return [...sunday.slice(weekStart), ...sunday.slice(0, weekStart)];
};

/* --- C08 range bars ---------------------------------------------------------- */

export type Range = Readonly<{ min: number; max: number }>;

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

export type StageSpan = Readonly<{ stage: SleepStage; start: number; end: number }>;

export type Hypnogram = Readonly<{
  blocks: readonly (Bar & { stage: SleepStage })[];
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

export type RingPart = Readonly<{ value: number; max: number }>;

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
}>;

export type EstimateRow = Readonly<{
  label: string;
  x: number;
  low: number | null;
  high: number | null;
  y: number;
}>;

export type EstimateRows = Readonly<{
  rows: readonly EstimateRow[];
  ticks: readonly Readonly<{ value: number; x: number }>[];
  /** Where the reference (a null, a control, an expected value) sits. */
  referenceX: number | null;
}>;

/**
 * Point estimates with interval whiskers, one row each, on a shared axis
 * with round ticks that cover every interval and the reference.
 */
export const estimateRows = (
  estimates: readonly Estimate[],
  box: Box,
  reference: number | null = null,
  domain?: readonly [number, number],
): EstimateRows => {
  const values = estimates.flatMap((e) => [e.estimate, e.low, e.high]).filter(finite);
  if (finite(reference)) values.push(reference);
  const ticks = domain
    ? niceTicks(domain[0], domain[1])
    : values.length === 0
      ? [0, 1]
      : niceTicks(Math.min(...values), Math.max(...values));
  const lo = domain?.[0] ?? ticks[0]!;
  const hi = domain?.[1] ?? ticks.at(-1)!;
  const span = hi - lo || 1;
  const x = (v: number): number => ((v - lo) / span) * box.width;
  const slot = estimates.length === 0 ? 0 : box.height / estimates.length;
  return {
    rows: estimates.map((e, i) => ({
      label: e.label,
      x: x(e.estimate),
      low: finite(e.low) ? x(e.low) : null,
      high: finite(e.high) ? x(e.high) : null,
      y: i * slot + slot / 2,
    })),
    ticks: ticks
      .filter((t) => t >= lo && t <= hi)
      .map((value) => ({ value, x: x(value) })),
    referenceX: finite(reference) ? x(reference) : null,
  };
};

export type NullFigure = Readonly<{
  bars: readonly Bar[];
  observedX: number;
  /** The share of the null at or beyond the observed value, 0 to 1. */
  atOrBeyond: number;
}>;

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
