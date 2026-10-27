/**
 * The arithmetic behind the closed analytics tools, so the model never does it.
 *
 * Pure and free of `server-only`: the tools read rows, these functions do the
 * maths, and the tests check them with hand-computed numbers. A statistic with
 * nothing to compute from is `null`, never 0, because 0 would read as a
 * measured value. Days are UTC calendar days.
 */

export const MS_PER_DAY = 86_400_000;

export type TimedValue = Readonly<{ at: Date; value: number }>;

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : sum(values) / values.length;

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const minimum = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((low, value) => Math.min(low, value));

export const maximum = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((high, value) => Math.max(high, value));

export type WindowSummary = Readonly<{
  start: string;
  end: string;
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}>;

/** One window of `compare_windows`; `chart.compare` summarises wearable windows with it too. */
export const summariseWindow = (
  window: Readonly<{ start: string; end: string }>,
  values: readonly number[],
): WindowSummary => ({
  start: window.start,
  end: window.end,
  n: values.length,
  mean: mean(values),
  median: median(values),
  min: minimum(values),
  max: maximum(values),
});

/** Median absolute deviation from the median, unscaled. */
export const mad = (values: readonly number[]): number | null => {
  const centre = median(values);
  if (centre === null) return null;
  return median(values.map((value) => Math.abs(value - centre)));
};

/** Scales a MAD to a standard deviation for normally distributed data. */
export const MAD_SCALE = 1.4826;

/**
 * (target median − baseline median) / (1.4826 · baseline MAD). `null` when
 * either side is empty or the baseline MAD is 0, where any change would be an
 * infinite z.
 */
export const robustZ = (
  baseline: readonly number[],
  target: readonly number[],
): number | null => {
  const centre = median(baseline);
  const spread = mad(baseline);
  const targetMedian = median(target);
  if (centre === null || spread === null || spread === 0 || targetMedian === null) {
    return null;
  }
  return (targetMedian - centre) / (MAD_SCALE * spread);
};

export type OlsFit = Readonly<{
  slopePerDay: number;
  fittedFirst: number;
  fittedLast: number;
}>;

/**
 * Least-squares slope per day, with the fitted values at the first and last
 * observation (no extrapolation past the data). Time is measured in days from
 * the first point and centred, so epoch milliseconds never get squared.
 * `null` below three points or under two days of span: too little to call a
 * direction.
 */
export const olsSlopePerDay = (points: readonly TimedValue[]): OlsFit | null => {
  if (points.length < 3) return null;
  const times = points.map((point) => point.at.getTime());
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (last - first < 2 * MS_PER_DAY) return null;
  const xs = times.map((time) => (time - first) / MS_PER_DAY);
  const ys = points.map((point) => point.value);
  const xMean = sum(xs) / xs.length;
  const yMean = sum(ys) / ys.length;
  const sxy = sum(xs.map((x, i) => (x - xMean) * (ys[i] - yMean)));
  const sxx = sum(xs.map((x) => (x - xMean) ** 2));
  const slopePerDay = sxy / sxx;
  const span = (last - first) / MS_PER_DAY;
  return {
    slopePerDay,
    fittedFirst: yMean - slopePerDay * xMean,
    fittedLast: yMean + slopePerDay * (span - xMean),
  };
};

export const dayIndex = (at: Date): number => Math.floor(at.getTime() / MS_PER_DAY);

/**
 * Longest run of days in `[firstDay, lastDay]` with no data, counting the run
 * before the first and after the last data day. No data at all is one gap the
 * length of the window.
 */
export const longestGapDays = (
  dataDays: readonly number[],
  firstDay: number,
  lastDay: number,
): number => {
  const inside = [...new Set(dataDays)]
    .filter((day) => day >= firstDay && day <= lastDay)
    .sort((a, b) => a - b);
  const edges = [firstDay - 1, ...inside, lastDay + 1];
  return edges
    .slice(1)
    .reduce((longest, day, i) => Math.max(longest, day - edges[i] - 1), 0);
};

export type Coverage = Readonly<{
  daysInWindow: number;
  daysWithData: number;
  coverageRatio: number;
  longestGapDays: number;
}>;

/** A window runs from start's day to end's day, inclusive. */
export const daysInWindow = (start: Date, end: Date): number =>
  dayIndex(end) - dayIndex(start) + 1;

export const coverage = (times: readonly Date[], start: Date, end: Date): Coverage => {
  const firstDay = dayIndex(start);
  const lastDay = dayIndex(end);
  const dataDays = times.map(dayIndex).filter((day) => day >= firstDay && day <= lastDay);
  const daysWithData = new Set(dataDays).size;
  const days = daysInWindow(start, end);
  return {
    daysInWindow: days,
    daysWithData,
    coverageRatio: daysWithData / days,
    longestGapDays: longestGapDays(dataDays, firstDay, lastDay),
  };
};

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export type Reading = Readonly<{
  /** The row id, when the read has it; the lower id wins a tie at one instant. */
  id?: string;
  value: number;
  unitUcum: string;
  effectiveAt: Date;
}>;

/**
 * The reading `range_position` places: the newest one, or the one at `at`
 * exactly. Synthea writes several rows at one instant, so a tie goes to the
 * lower id, as on the Biomarkers tab. `null` when there is none.
 */
export const pickReading = <T extends Reading>(
  readings: readonly T[],
  at: Date | null,
): T | null => {
  const candidates =
    at === null
      ? readings
      : readings.filter((reading) => reading.effectiveAt.getTime() === at.getTime());
  return (
    [...candidates].sort(
      (a, b) =>
        b.effectiveAt.getTime() - a.effectiveAt.getTime() || byId(a.id ?? "", b.id ?? ""),
    )[0] ?? null
  );
};

/**
 * Each subject's own latest reading, as `pickReading` picks it (newest; a tie
 * at one instant to the lower id), so a person counts once however many rows
 * they have. Keyed by subject_ref.
 */
export const latestPerSubject = <T extends Reading & Readonly<{ subjectRef: string }>>(
  readings: readonly T[],
): ReadonlyMap<string, T> => {
  const bySubject = new Map<string, T[]>();
  for (const reading of readings) {
    const own = bySubject.get(reading.subjectRef);
    if (own) own.push(reading);
    else bySubject.set(reading.subjectRef, [reading]);
  }
  const latest = new Map<string, T>();
  for (const [subjectRef, own] of bySubject) {
    const picked = pickReading(own, null);
    if (picked) latest.set(subjectRef, picked);
  }
  return latest;
};

export type MidRankPercentile = Readonly<{
  /** Values compared, the subject's own included. */
  n: number;
  nLower: number;
  /** Values equal to the subject's, the subject's own included, so at least 1. */
  nEqual: number;
  nHigher: number;
  /** 100 × (nLower + nEqual / 2) / n. */
  percentile: number;
}>;

/**
 * Mid-rank percentile of `value` among `values`, which must include `value`
 * itself: 100 × (lower + equal / 2) / n. Ties count half, so the result never
 * depends on the order of equal values. `null` when `value` is not among
 * `values` (nothing to rank).
 */
export const midRankPercentile = (
  value: number,
  values: readonly number[],
): MidRankPercentile | null => {
  const nLower = values.filter((other) => other < value).length;
  const nEqual = values.filter((other) => other === value).length;
  const nHigher = values.length - nLower - nEqual;
  if (nEqual === 0) return null;
  return {
    n: values.length,
    nLower,
    nEqual,
    nHigher,
    percentile: (100 * (nLower + nEqual / 2)) / values.length,
  };
};
