/**
 * Sensitivity, specificity and AUROC per metric for a set of windows, with
 * cluster-bootstrap 95 % intervals. Pure; each summary seeds its own
 * generator from the benchmark seed and the subset's key, so results do not
 * depend on the order subsets are computed in.
 */
import { randomFor } from "@/infrastructure/seeded-random";

import {
  auroc,
  clusterBootstrap,
  type Estimate,
  sensitivity,
  specificity,
} from "./statistics";
import { isMixed, METRICS, type MetricName, type WindowRow } from "./windows";

export type ProportionEstimate = Estimate & Readonly<{ k: number; n: number }>;

export type AurocEstimate = Estimate &
  Readonly<{
    /** Windows left out because the metric is null (sample entropy with no matches). */
    nullPositive: number;
    nullNegative: number;
  }>;

export type Summary = Readonly<{
  key: string;
  nWindows: number;
  nClusters: number;
  nPositive: number;
  nNegative: number;
  nMixed: number;
  sensitivity: ProportionEstimate;
  specificity: ProportionEstimate;
  auroc: Readonly<Record<MetricName, AurocEstimate>>;
}>;

/** Rows grouped by cluster, clusters in order of first appearance. */
export const clustersOf = (rows: readonly WindowRow[]): WindowRow[][] => {
  const groups = new Map<string, WindowRow[]>();
  for (const row of rows) {
    const group = groups.get(row.cluster);
    if (group === undefined) groups.set(row.cluster, [row]);
    else group.push(row);
  }
  return [...groups.values()];
};

const scoresOf = (
  rows: readonly WindowRow[],
  metric: MetricName,
  positive: boolean,
): number[] =>
  rows
    .filter((row) => row.positive === positive)
    .map((row) => row.metrics[metric])
    .filter((value): value is number => value !== null);

export const metricAuroc = (
  rows: readonly WindowRow[],
  metric: MetricName,
): number | null => auroc(scoresOf(rows, metric, true), scoresOf(rows, metric, false));

export const summarise = (
  key: string,
  rows: readonly WindowRow[],
  resamples: number,
  seed: number,
): Summary => {
  const clusters = clustersOf(rows);
  const sens = sensitivity(rows);
  const spec = specificity(rows);
  const boot = (
    name: string,
    statistic: (subset: readonly WindowRow[]) => number | null,
  ) =>
    clusterBootstrap(
      clusters,
      statistic,
      resamples,
      randomFor(seed, `bootstrap:${key}:${name}`),
    );
  const aurocs = Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      {
        ...boot(metric, (subset) => metricAuroc(subset, metric)),
        nullPositive: rows.filter((row) => row.positive && row.metrics[metric] === null)
          .length,
        nullNegative: rows.filter((row) => !row.positive && row.metrics[metric] === null)
          .length,
      },
    ]),
  ) as Record<MetricName, AurocEstimate>;
  return {
    key,
    nWindows: rows.length,
    nClusters: clusters.length,
    nPositive: sens.n,
    nNegative: spec.n,
    nMixed: rows.filter(isMixed).length,
    sensitivity: {
      k: sens.k,
      n: sens.n,
      ...boot("sensitivity", (subset) => sensitivity(subset).value),
    },
    specificity: {
      k: spec.k,
      n: spec.n,
      ...boot("specificity", (subset) => specificity(subset).value),
    },
    auroc: aurocs,
  };
};

/** One summary per distinct key, keys in first-seen order. */
export const summariseBy = <R extends WindowRow>(
  prefix: string,
  rows: readonly R[],
  keyOf: (row: R) => string,
  resamples: number,
  seed: number,
): Summary[] => {
  const keys = [...new Set(rows.map(keyOf))];
  return keys.map((key) =>
    summarise(
      `${prefix}=${key}`,
      rows.filter((row) => keyOf(row) === key),
      resamples,
      seed,
    ),
  );
};
