/**
 * Statistics for the rhythm benchmark. Pure; randomness only through the
 * `Random` passed in.
 *
 * Confidence intervals are percentile bootstraps that resample clusters
 * (simulated recordings, or database records), not windows: windows of one
 * recording are not independent.
 */
import { type Random } from "@/infrastructure/seeded-random";

export type Scored = Readonly<{ positive: boolean; flagged: boolean }>;

export type Proportion = Readonly<{ k: number; n: number; value: number | null }>;

const proportion = (k: number, n: number): Proportion => ({
  k,
  n,
  value: n === 0 ? null : k / n,
});

/** Flagged positives over positives. */
export const sensitivity = (rows: readonly Scored[]): Proportion => {
  const positives = rows.filter((row) => row.positive);
  return proportion(positives.filter((row) => row.flagged).length, positives.length);
};

/** Unflagged negatives over negatives. */
export const specificity = (rows: readonly Scored[]): Proportion => {
  const negatives = rows.filter((row) => !row.positive);
  return proportion(negatives.filter((row) => !row.flagged).length, negatives.length);
};

/** Mid-ranks (1-based) of the values, ties sharing their mean rank. */
export const midRanks = (values: readonly number[]): number[] => {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value)
      end += 1;
    const rank = (start + end) / 2 + 1;
    for (let i = start; i <= end; i += 1) ranks[order[i].index] = rank;
    start = end + 1;
  }
  return ranks;
};

/**
 * Area under the ROC curve as P(score of a positive > score of a negative),
 * ties counting one half (Mann-Whitney). Null without both classes.
 */
export const auroc = (
  positives: readonly number[],
  negatives: readonly number[],
): number | null => {
  if (positives.length === 0 || negatives.length === 0) return null;
  const ranks = midRanks([...positives, ...negatives]);
  const rankSum = ranks
    .slice(0, positives.length)
    .reduce((total, rank) => total + rank, 0);
  const p = positives.length;
  return (rankSum - (p * (p + 1)) / 2) / (p * negatives.length);
};

export type RocPoint = Readonly<{ threshold: number; fpr: number; tpr: number }>;

/** ROC points for "flag when score ≥ threshold", one per distinct score, from (0, 0) to (1, 1). */
export const rocPoints = (
  positives: readonly number[],
  negatives: readonly number[],
): RocPoint[] => {
  if (positives.length === 0 || negatives.length === 0) return [];
  const thresholds = [...new Set([...positives, ...negatives])].sort((a, b) => b - a);
  const pos = [...positives].sort((a, b) => b - a);
  const neg = [...negatives].sort((a, b) => b - a);
  let i = 0;
  let j = 0;
  const points: RocPoint[] = [{ threshold: Infinity, fpr: 0, tpr: 0 }];
  for (const threshold of thresholds) {
    while (i < pos.length && pos[i] >= threshold) i += 1;
    while (j < neg.length && neg[j] >= threshold) j += 1;
    points.push({ threshold, fpr: j / neg.length, tpr: i / pos.length });
  }
  return points;
};

/** Linear-interpolation quantile (type 7) of sorted values. */
export const quantileSorted = (sorted: readonly number[], q: number): number | null => {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};

export type Interval = Readonly<{ low: number | null; high: number | null }>;

export type Estimate = Readonly<{ value: number | null; ci95: Interval }>;

/**
 * The statistic on all rows, with a percentile bootstrap 95 % interval from
 * `resamples` draws of whole clusters with replacement. Draws where the
 * statistic is null (a class missing) are left out of the interval.
 */
export const clusterBootstrap = <T>(
  clusters: ReadonlyArray<readonly T[]>,
  statistic: (rows: readonly T[]) => number | null,
  resamples: number,
  random: Random,
): Estimate => {
  const value = statistic(clusters.flat());
  if (clusters.length === 0 || resamples === 0)
    return { value, ci95: { low: null, high: null } };
  const draws: number[] = [];
  for (let b = 0; b < resamples; b += 1) {
    const rows: T[] = [];
    for (let c = 0; c < clusters.length; c += 1) {
      rows.push(...clusters[Math.floor(random() * clusters.length)]);
    }
    const drawn = statistic(rows);
    if (drawn !== null && Number.isFinite(drawn)) draws.push(drawn);
  }
  const sorted = draws.sort((a, b) => a - b);
  return {
    value,
    ci95: { low: quantileSorted(sorted, 0.025), high: quantileSorted(sorted, 0.975) },
  };
};

/** Wasserstein-1 (earth mover's) distance between two samples: ∫ |F − G|. */
export const wasserstein1 = (
  a: readonly number[],
  b: readonly number[],
): number | null => {
  if (a.length === 0 || b.length === 0) return null;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  const all = [...x, ...y].sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let total = 0;
  for (let k = 0; k < all.length - 1; k += 1) {
    while (i < x.length && x[i] <= all[k]) i += 1;
    while (j < y.length && y[j] <= all[k]) j += 1;
    total += Math.abs(i / x.length - j / y.length) * (all[k + 1] - all[k]);
  }
  return total;
};

/** Two-sample Kolmogorov-Smirnov statistic: sup |F − G|. */
export const ksStatistic = (
  a: readonly number[],
  b: readonly number[],
): number | null => {
  if (a.length === 0 || b.length === 0) return null;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let largest = 0;
  while (i < x.length && j < y.length) {
    const next = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= next) i += 1;
    while (j < y.length && y[j] <= next) j += 1;
    largest = Math.max(largest, Math.abs(i / x.length - j / y.length));
  }
  return largest;
};
