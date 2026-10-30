/**
 * Windows of labelled RR intervals and their metrics, with the metric
 * functions of the `rhythm_irregularity` tool (`irregularityWindow`,
 * `beatWindows` in packages/query-tools/stats.ts), not a copy of them. Pure.
 *
 * Label rule: a window counts as AF when at least half of its intervals are
 * AF (`AF_WINDOW_SHARE`); a window with some AF and some other intervals is
 * "mixed" and is reported separately as well.
 */
import {
  beatWindows,
  IRREGULARITY_THRESHOLDS,
  irregularityWindow,
} from "@/packages/query-tools/stats";

export const WINDOW_BEATS = IRREGULARITY_THRESHOLDS.windowBeats;
export const AF_WINDOW_SHARE = 0.5;

export const METRICS = [
  "nrmssd",
  "turning_point_ratio",
  "shannon_entropy",
  "sample_entropy",
] as const;
export type MetricName = (typeof METRICS)[number];

export type WindowRow = Readonly<{
  /** Recording or record the window comes from (the bootstrap cluster). */
  cluster: string;
  index: number;
  n: number;
  meanRrMs: number;
  /** The window's intervals, ms (for interval-level distributions). */
  rr: readonly number[];
  /** Share of the window's intervals labelled AF. */
  afShare: number;
  /** The dominant reference label (most intervals; ties go to the first seen). */
  dominant: string;
  /** Every interval has the same reference label. */
  singleLabel: boolean;
  positive: boolean;
  flagged: boolean;
  metrics: Readonly<Record<MetricName, number | null>>;
}>;

export const isMixed = (row: Pick<WindowRow, "afShare">): boolean =>
  row.afShare > 0 && row.afShare < 1;

export const dominantLabel = (labels: readonly string[]): string => {
  const counts = labels.reduce<Map<string, number>>(
    (tally, label) => tally.set(label, (tally.get(label) ?? 0) + 1),
    new Map(),
  );
  return [...counts.entries()].reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  )[0];
};

export const windowRow = (
  cluster: string,
  index: number,
  rr: readonly number[],
  labels: readonly string[],
  isAf: (label: string) => boolean,
): WindowRow => {
  const metrics = irregularityWindow(rr);
  const afShare = labels.filter(isAf).length / labels.length;
  return {
    cluster,
    index,
    n: rr.length,
    meanRrMs: rr.reduce((total, value) => total + value, 0) / rr.length,
    rr,
    afShare,
    dominant: dominantLabel(labels),
    singleLabel: labels.every((label) => label === labels[0]),
    positive: afShare >= AF_WINDOW_SHARE,
    flagged: metrics.flagged,
    metrics: {
      nrmssd: metrics.nrmssd,
      turning_point_ratio: metrics.turning_point_ratio,
      shannon_entropy: metrics.shannon_entropy,
      sample_entropy: metrics.sample_entropy,
    },
  };
};

/**
 * Consecutive 128-interval windows as the tool takes them. A series with
 * fewer than 128 intervals (a short simulated recording) gives one window of
 * all of them when `shortAsOne` is set, which the tool does not do: it
 * refuses such recordings. The turning-point band is then the one for that n.
 */
export const labelledWindows = (
  cluster: string,
  rr: readonly number[],
  labels: readonly string[],
  isAf: (label: string) => boolean,
  shortAsOne: boolean,
  firstIndex = 0,
): WindowRow[] => {
  if (rr.length < WINDOW_BEATS) {
    return shortAsOne && rr.length >= 3
      ? [windowRow(cluster, firstIndex, rr, labels, isAf)]
      : [];
  }
  const labelWindows = beatWindows(labels, WINDOW_BEATS);
  return beatWindows(rr, WINDOW_BEATS).map((window, i) =>
    windowRow(cluster, firstIndex + i, window, labelWindows[i], isAf),
  );
};
