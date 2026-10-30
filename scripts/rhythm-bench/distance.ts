/**
 * How far simulated windows are from real ones, per rhythm class: the
 * Wasserstein-1 distance and the Kolmogorov-Smirnov statistic of each metric,
 * of the window mean RR and of the intervals and successive differences,
 * raw and divided by their window's mean RR. Pure.
 */
import { ksStatistic, wasserstein1 } from "./statistics";
import { METRICS, type WindowRow } from "./windows";

export const QUANTITIES = [
  ...METRICS,
  "mean_rr_ms",
  "rr_ms",
  "drr_ms",
  "rr_norm",
  "drr_norm",
] as const;
export type Quantity = (typeof QUANTITIES)[number];

const nonNull = (values: ReadonlyArray<number | null>): number[] =>
  values.filter((value): value is number => value !== null);

/** All values of one quantity over the windows. */
export const valuesOf = (rows: readonly WindowRow[], quantity: Quantity): number[] => {
  switch (quantity) {
    case "mean_rr_ms":
      return rows.map((row) => row.meanRrMs);
    case "rr_ms":
      return rows.flatMap((row) => [...row.rr]);
    case "drr_ms":
      return rows.flatMap((row) => row.rr.slice(1).map((value, i) => value - row.rr[i]));
    case "rr_norm":
      return rows.flatMap((row) => row.rr.map((value) => value / row.meanRrMs));
    case "drr_norm":
      return rows.flatMap((row) =>
        row.rr.slice(1).map((value, i) => (value - row.rr[i]) / row.meanRrMs),
      );
    default:
      return nonNull(rows.map((row) => row.metrics[quantity]));
  }
};

const sd = (values: readonly number[]): number | null => {
  if (values.length < 2) return null;
  const centre = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((total, value) => total + (value - centre) ** 2, 0) /
      (values.length - 1),
  );
};

export type Distance = Readonly<{
  quantity: Quantity;
  nSim: number;
  nReal: number;
  wasserstein1: number | null;
  /** W1 over the real values' SD, so quantities can be compared. */
  wasserstein1InRealSd: number | null;
  ks: number | null;
  simMedian: number | null;
  realMedian: number | null;
}>;

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const distanceOf = (
  quantity: Quantity,
  sim: readonly number[],
  real: readonly number[],
): Distance => {
  const w1 = wasserstein1(sim, real);
  const spread = sd(real);
  return {
    quantity,
    nSim: sim.length,
    nReal: real.length,
    wasserstein1: w1,
    wasserstein1InRealSd:
      w1 === null || spread === null || spread === 0 ? null : w1 / spread,
    ks: ksStatistic(sim, real),
    simMedian: median(sim),
    realMedian: median(real),
  };
};

export const distances = (
  sim: readonly WindowRow[],
  real: readonly WindowRow[],
): Distance[] =>
  QUANTITIES.map((quantity) =>
    distanceOf(quantity, valuesOf(sim, quantity), valuesOf(real, quantity)),
  );
