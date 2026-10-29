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

/** `day` moved by `days` (back when negative), as a UTC `YYYY-MM-DD`. */
export const addDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

/** The UTC day of an instant, `YYYY-MM-DD`. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

export const RECENT_DAYS = 7;
export const BASELINE_DAYS = 28;

export type DayWindow = Readonly<{ start: string; end: string }>;

/**
 * The 7 days ending on `endDay` and the 28 days before them, inclusive UTC
 * days. The wearable trends compare the two; `training_load` sums each.
 */
export const recentAndBaseline = (
  endDay: string,
): Readonly<{ recent: DayWindow; baseline: DayWindow }> => ({
  recent: { start: addDays(endDay, 1 - RECENT_DAYS), end: endDay },
  baseline: {
    start: addDays(endDay, 1 - RECENT_DAYS - BASELINE_DAYS),
    end: addDays(endDay, -RECENT_DAYS),
  },
});

/** The Monday that starts the UTC week holding `day`. */
export const weekStart = (day: string): string =>
  addDays(day, -((new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7));

/**
 * Minutes in the last 7 days against a quarter of the minutes in the 28 days
 * before them, so 1 means the same weekly minutes. `null` when those four
 * weeks have none: there is nothing to compare with.
 */
export const recentLoadRatio = (recent: number, previous: number): number | null =>
  previous === 0 ? null : (recent * 4) / previous;

// ─── rhythm_irregularity: RR-interval irregularity ──────────────────────────
// Descriptions of a series of RR intervals (ms). They say how irregular a
// recording is; none of them says what rhythm a person has.

/**
 * The series without its `count` largest and `count` smallest values, in the
 * original order. Equal values are dropped by position, first ones first.
 * Dash et al. 2009 drop 8 of each from a 128-beat segment before the
 * Shannon entropy histogram.
 */
export const withoutExtremes = (values: readonly number[], count: number): number[] => {
  if (values.length <= 2 * count) return [];
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  const dropped = new Set(
    [...order.slice(0, count), ...order.slice(order.length - count)].map(
      (entry) => entry.index,
    ),
  );
  return values.filter((_, index) => !dropped.has(index));
};

/** Root mean square of successive differences divided by the mean. `null` under 2 values. */
export const normalisedRmssd = (rr: readonly number[]): number | null => {
  if (rr.length < 2) return null;
  const centre = mean(rr);
  if (centre === null || centre === 0) return null;
  const squares = rr.slice(1).map((value, i) => (value - rr[i]) ** 2);
  return Math.sqrt(sum(squares) / squares.length) / centre;
};

/**
 * Shannon entropy of the values' histogram in `bins` equal-width bins from the
 * minimum to the maximum (the maximum in the last bin), divided by ln(bins) so
 * it runs from 0 (one bin) to 1 (spread evenly). `null` when empty; 0 when
 * every value is equal.
 */
export const histogramEntropy = (values: readonly number[], bins = 16): number | null => {
  const low = minimum(values);
  const high = maximum(values);
  if (low === null || high === null) return null;
  if (high === low) return 0;
  const width = (high - low) / bins;
  const counts = values.reduce<number[]>(
    (tally, value) => {
      const bin = Math.min(bins - 1, Math.floor((value - low) / width));
      return tally.map((count, index) => (index === bin ? count + 1 : count));
    },
    Array.from({ length: bins }, () => 0),
  );
  const entropy = counts
    .filter((count) => count > 0)
    .map((count) => count / values.length)
    .reduce((total, p) => total - p * Math.log(p), 0);
  return entropy / Math.log(bins);
};

/** Population standard deviation. `null` when empty. */
export const populationSd = (values: readonly number[]): number | null => {
  const centre = mean(values);
  return centre === null
    ? null
    : Math.sqrt(sum(values.map((value) => (value - centre) ** 2)) / values.length);
};

/**
 * Sample entropy (Richman and Moorman 2000): −ln(A / B) = ln(B / A), where B counts pairs
 * of templates of length m and A pairs of length m + 1 that stay within r of
 * each other at every point (Chebyshev distance ≤ r), over the same N − m
 * templates, self-matches excluded. r defaults to 0.2 × the population SD.
 * `null` when B or A is 0 (undefined) or the series is shorter than m + 2.
 */
export const sampleEntropy = (
  values: readonly number[],
  m = 2,
  r: number | null = null,
): number | null => {
  const n = values.length;
  if (n < m + 2) return null;
  const tolerance = r ?? 0.2 * (populationSd(values) ?? 0);
  const templates = n - m;
  const matchesUpTo = (i: number, j: number, length: number): boolean =>
    Array.from({ length }, (_, k) => k).every(
      (k) => Math.abs(values[i + k] - values[j + k]) <= tolerance,
    );
  let b = 0;
  let a = 0;
  for (let i = 0; i < templates; i += 1) {
    for (let j = i + 1; j < templates; j += 1) {
      if (matchesUpTo(i, j, m)) {
        b += 1;
        if (Math.abs(values[i + m] - values[j + m]) <= tolerance) a += 1;
      }
    }
  }
  return a === 0 || b === 0 ? null : Math.log(b / a);
};

/** Points strictly above both neighbours or strictly below both. */
export const turningPoints = (values: readonly number[]): number =>
  values
    .slice(1, -1)
    .filter(
      (value, i) =>
        (value > values[i] && value > values[i + 2]) ||
        (value < values[i] && value < values[i + 2]),
    ).length;

export type TurningPointRange = Readonly<{ low: number; high: number }>;

/** Two-sided 99.9 % normal quantile; Dash et al. 2009 chose the 99.9 % interval. */
export const TPR_Z_999 = 3.2905;

/**
 * For n independent values the turning-point count has mean (2n − 4) / 3 and
 * variance (16n − 29) / 90; this is that mean ± z SD as a ratio of n. With
 * n = 128 and the 99.9 % z it is 0.535 to 0.778, which Dash et al. 2009 report
 * rounded as 0.54 < TPR < 0.77.
 */
export const randomTurningPointRange = (n: number, z = TPR_Z_999): TurningPointRange => {
  const centre = (2 * n - 4) / 3;
  const spread = z * Math.sqrt((16 * n - 29) / 90);
  return { low: (centre - spread) / n, high: (centre + spread) / n };
};

/** The research rule of Dash et al. 2009 as the tool applies it (see irregularityWindow). */
export const IRREGULARITY_THRESHOLDS = {
  windowBeats: 128,
  extremesDropped: 8,
  histogramBins: 16,
  nrmssdAbove: 0.1,
  /** Dash et al. 2009's Shannon entropy threshold; reported, not used in the flag. */
  entropyAbove: 0.7,
} as const;

export type IrregularityWindow = Readonly<{
  /** RR intervals in the window. */
  n: number;
  nrmssd: number | null;
  /** Implemented as Dash et al. 2009 describe it but not validated here; not in the flag. */
  shannon_entropy: number | null;
  sample_entropy: number | null;
  turning_point_ratio: number | null;
  /** nRMSSD above 0.1 and the turning-point ratio inside the 99.9 % band of random values. */
  flagged: boolean;
}>;

/**
 * One window, as Dash et al. 2009 describe it: nRMSSD and the turning-point
 * ratio over the whole window; the 16-bin Shannon entropy over the window
 * without its 8 longest and 8 shortest intervals, bins from the shortest to
 * the longest left, divided by ln 16. Sample entropy (m 2, r 0.2 SD) over the
 * whole window. Flagged when nRMSSD > 0.1 and the turning-point ratio lies in
 * the 99.9 % band; the paper's third condition (entropy > 0.7) is left out
 * because on simulated sinus rhythm this entropy is as high as in AF
 * (docs/query-layer.md, "Rhythm irregularity").
 */
export const irregularityWindow = (rr: readonly number[]): IrregularityWindow => {
  const kept = withoutExtremes(rr, IRREGULARITY_THRESHOLDS.extremesDropped);
  const nrmssd = normalisedRmssd(rr);
  const ratio = rr.length < 3 ? null : turningPoints(rr) / rr.length;
  const band = randomTurningPointRange(rr.length);
  return {
    n: rr.length,
    nrmssd,
    shannon_entropy: histogramEntropy(kept, IRREGULARITY_THRESHOLDS.histogramBins),
    sample_entropy: sampleEntropy(rr),
    turning_point_ratio: ratio,
    flagged:
      nrmssd !== null &&
      ratio !== null &&
      nrmssd > IRREGULARITY_THRESHOLDS.nrmssdAbove &&
      ratio >= band.low &&
      ratio <= band.high,
  };
};

/** Consecutive, non-overlapping windows of `size`; a shorter tail is left out. */
export const beatWindows = <T>(values: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.floor(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
