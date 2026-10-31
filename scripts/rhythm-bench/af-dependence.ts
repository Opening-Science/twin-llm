/**
 * Short-range dependence of AF intervals (#297): the sample autocorrelation of
 * ln RR at a lag in each AF window, summarised over windows and over clusters
 * (recordings or records). These lag-1 values in the MIT-BIH AF Database are
 * what `AF_SHORT_RANGE_PHI` was fitted to. Pure.
 */
import { autocorrelation } from "@/packages/rhythm-sim/af-interval";

import { type WindowRow } from "./windows";

export const DEPENDENCE_LAGS = [1, 2, 3] as const;

export type LagSummary = Readonly<{
  lag: number;
  windows: number;
  clusters: number;
  /** Median over all windows. */
  pooledMedian: number | null;
  /** Median over clusters of each cluster's median, so long records do not dominate. */
  medianOfClusterMedians: number | null;
}>;

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Lag-`lag` autocorrelation of ln RR of one window, or null when undefined. */
export const windowLag = (row: Pick<WindowRow, "rr">, lag: number): number | null =>
  autocorrelation(
    row.rr.map((value) => Math.log(value)),
    lag,
  );

export const lagSummary = (
  rows: readonly Pick<WindowRow, "rr" | "cluster">[],
  lag: number,
): LagSummary => {
  const byCluster = rows.reduce<Map<string, number[]>>((groups, row) => {
    const value = windowLag(row, lag);
    if (value === null) return groups;
    return groups.set(row.cluster, [...(groups.get(row.cluster) ?? []), value]);
  }, new Map());
  const values = [...byCluster.values()].flat();
  return {
    lag,
    windows: values.length,
    clusters: byCluster.size,
    pooledMedian: median(values),
    medianOfClusterMedians: median(
      [...byCluster.values()]
        .map((each) => median(each))
        .filter((value): value is number => value !== null),
    ),
  };
};
