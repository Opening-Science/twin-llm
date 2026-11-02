/**
 * Does RR resolution explain the gap between simulated and real AF (#418)?
 * Simulated all-AF windows (noise none, full 128 intervals, as in the
 * benchmark's simulated-against-real table) at several sampling grids and
 * both AF modes, against the all-AFIB windows of the two databases: medians
 * of the turning-point ratio (strict, non-strict and with ties broken at
 * random), sample entropy and the share of tied neighbours, with 95 %
 * percentile bootstrap intervals over recordings and records. Pure.
 *
 * One bootstrap draw resamples the recordings of each AF mode (the same
 * recordings at every grid) and the records of each database together, so
 * the gap and the share of it a grid closes get intervals of their own.
 */
import { RHYTHM_BENCH_DIR } from "@/infrastructure/local-artefacts";
import { mulberry32, randomFor } from "@/infrastructure/seeded-random";
import { type AfDependence, AF_DEPENDENCES } from "@/packages/rhythm-sim/af-interval";

import { type DatabaseId } from "./databases";
import {
  RR_GRIDS_MS,
  tiedNeighbourShare,
  turningPointsNonStrict,
  turningPointsTiesBroken,
} from "./rr-grid";
import { type Estimate, ksStatistic, quantileSorted } from "./statistics";
import { WINDOW_BEATS, type WindowRow } from "./windows";

export const STUDY_VERSION = 1;
export const STUDY_GRIDS_MS = [0, RR_GRIDS_MS.afdb, RR_GRIDS_MS.ltafdb] as const;
export const DEFAULT_SEEDS = 20;
export const DEFAULT_RESAMPLES = 1000;
export const DEFAULT_BOOTSTRAP_SEED = 418;

export const STUDY_METRICS = [
  "tpr",
  "tpr_non_strict",
  "tpr_ties_broken",
  "sample_entropy",
  "tie_share",
] as const;
export type StudyMetric = (typeof STUDY_METRICS)[number];

/** The metrics whose gap to the database is the question. */
export const GAP_METRICS = ["tpr", "sample_entropy"] as const;

export type WindowValues = Readonly<{
  cluster: string;
  values: Readonly<Record<StudyMetric, number | null>>;
}>;

/**
 * The study's values for one window. Ties are broken with a generator keyed
 * by the window, so the same window always gives the same count.
 */
export const windowValues = (
  row: Pick<WindowRow, "cluster" | "index" | "rr" | "metrics">,
  seed: number,
): WindowValues => {
  const n = row.rr.length;
  return {
    cluster: row.cluster,
    values: {
      tpr: row.metrics.turning_point_ratio,
      tpr_non_strict: n < 3 ? null : turningPointsNonStrict(row.rr) / n,
      tpr_ties_broken:
        n < 3
          ? null
          : turningPointsTiesBroken(
              row.rr,
              randomFor(seed, `${row.cluster}|${row.index}`),
            ) / n,
      sample_entropy: row.metrics.sample_entropy,
      tie_share: tiedNeighbourShare(row.rr),
    },
  };
};

/** Full windows that are all AF: `afShare` 1 (simulated) or all AFIB (database). */
export const isFullAfWindow = (
  row: Pick<WindowRow, "n" | "afShare" | "singleLabel">,
): boolean => row.n === WINDOW_BEATS && row.afShare === 1 && row.singleLabel;

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;

/**
 * Medians as in the benchmark's tables, and means: a window's turning-point
 * ratio is a count over 128, so its median moves in steps of 1/128 (0.0078)
 * and the mean shows smaller shifts.
 */
export const STATISTICS = { median, mean } as const;
export type StatisticName = keyof typeof STATISTICS;
const STATISTIC_NAMES = Object.keys(STATISTICS) as StatisticName[];

type Clustered = Readonly<Record<StudyMetric, readonly (readonly number[])[]>>;

/** Values per metric per cluster, clusters in order of first appearance. */
export const byCluster = (rows: readonly WindowValues[]): Clustered => {
  const order = [...new Set(rows.map((row) => row.cluster))];
  const at = new Map(order.map((cluster, i) => [cluster, i]));
  return Object.fromEntries(
    STUDY_METRICS.map((metric) => {
      const groups: number[][] = order.map(() => []);
      for (const row of rows) {
        const value = row.values[metric];
        if (value !== null) groups[at.get(row.cluster) ?? 0].push(value);
      }
      return [metric, groups];
    }),
  ) as Record<StudyMetric, number[][]>;
};

export type SimArm = Readonly<{
  mode: AfDependence;
  gridMs: number;
  rows: readonly WindowValues[];
}>;
export type RealArm = Readonly<{ database: DatabaseId; rows: readonly WindowValues[] }>;

export type Gap = Readonly<{
  /** Simulated minus database. */
  gap: Estimate;
  /** Share of the same mode's gap at grid 0 that this grid closes: 1 − gap / gap at 0. */
  closed: Estimate;
}>;

type GapMetric = (typeof GAP_METRICS)[number];
export type Centres = Readonly<
  Record<StatisticName, Readonly<Record<StudyMetric, Estimate>>>
>;

export type SimArmSummary = Readonly<{
  mode: AfDependence;
  gridMs: number;
  recordings: number;
  windows: number;
  centres: Centres;
  /** Per database: the gap of each statistic and the KS statistic, per gap metric. */
  gaps: Readonly<
    Partial<
      Record<
        DatabaseId,
        Readonly<
          Record<GapMetric, Readonly<Record<StatisticName, Gap>> & { ks: number | null }>
        >
      >
    >
  >;
}>;

export type RealArmSummary = Readonly<{
  database: DatabaseId;
  records: number;
  windows: number;
  centres: Centres;
}>;

export type StudyResult = Readonly<{
  sim: readonly SimArmSummary[];
  real: readonly RealArmSummary[];
}>;

const interval = (draws: readonly number[]): Estimate["ci95"] => {
  const sorted = draws.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return { low: quantileSorted(sorted, 0.025), high: quantileSorted(sorted, 0.975) };
};

const pooled = (
  clusters: readonly (readonly number[])[],
  picks: readonly number[],
): number[] => {
  const values: number[] = [];
  for (const pick of picks) values.push(...clusters[pick]);
  return values;
};

const valuesOf = (rows: readonly WindowValues[], metric: StudyMetric): number[] =>
  rows
    .map((row) => row.values[metric])
    .filter((value): value is number => value !== null);

const closedShare = (gap: number | null, gapAtZero: number | null): number | null =>
  gap === null || gapAtZero === null || gapAtZero === 0 ? null : 1 - gap / gapAtZero;

const key = (statistic: StatisticName, metric: StudyMetric) => `${statistic}:${metric}`;

type Draws = Map<string, number[]>;

const drawsFor = (clusters: Clustered, picks: readonly number[], into: Draws): void => {
  for (const metric of STUDY_METRICS) {
    const values = pooled(clusters[metric], picks);
    for (const statistic of STATISTIC_NAMES) {
      const list = into.get(key(statistic, metric)) ?? [];
      list.push(STATISTICS[statistic](values) ?? Number.NaN);
      into.set(key(statistic, metric), list);
    }
  }
};

const centresOf = (rows: readonly WindowValues[], draws: Draws): Centres =>
  Object.fromEntries(
    STATISTIC_NAMES.map((statistic) => [
      statistic,
      Object.fromEntries(
        STUDY_METRICS.map((metric) => [
          metric,
          {
            value: STATISTICS[statistic](valuesOf(rows, metric)),
            ci95: interval(draws.get(key(statistic, metric)) ?? []),
          },
        ]),
      ),
    ]),
  ) as Centres;

/**
 * Centres, gaps and the share of the gap closed, with intervals. Simulated
 * arms of one mode must come from the same recordings (cluster names).
 */
export const studyResult = (
  simArms: readonly SimArm[],
  realArms: readonly RealArm[],
  resamples: number,
  bootstrapSeed: number,
): StudyResult => {
  const random = mulberry32(bootstrapSeed);
  const sim = simArms.map((arm) => ({ arm, clusters: byCluster(arm.rows) }));
  const real = realArms.map((arm) => ({ arm, clusters: byCluster(arm.rows) }));
  const modes = [...new Set(simArms.map((arm) => arm.mode))];
  const clusterCount = (clusters: Clustered) => clusters.tpr.length;
  const simDraws: Draws[] = sim.map(() => new Map());
  const realDraws: Draws[] = real.map(() => new Map());
  const picksOf = (n: number) =>
    Array.from({ length: n }, () => Math.floor(random() * n));
  for (let b = 0; b < resamples; b += 1) {
    const modePicks = new Map(
      modes.map((mode) => {
        const first = sim.find((each) => each.arm.mode === mode);
        return [mode, picksOf(first === undefined ? 0 : clusterCount(first.clusters))];
      }),
    );
    sim.forEach((each, i) =>
      drawsFor(each.clusters, modePicks.get(each.arm.mode) ?? [], simDraws[i]),
    );
    real.forEach((each, i) =>
      drawsFor(each.clusters, picksOf(clusterCount(each.clusters)), realDraws[i]),
    );
  }
  const realSummaries: RealArmSummary[] = real.map((each, i) => ({
    database: each.arm.database,
    records: clusterCount(each.clusters),
    windows: each.arm.rows.length,
    centres: centresOf(each.arm.rows, realDraws[i]),
  }));
  const simSummaries: SimArmSummary[] = sim.map((each, i) => {
    const zero = sim.findIndex(
      (other) => other.arm.mode === each.arm.mode && other.arm.gridMs === 0,
    );
    const gapOf = (r: number, metric: GapMetric, statistic: StatisticName): Gap => {
      const target = real[r].arm.rows;
      const centre = (rows: readonly WindowValues[]) =>
        STATISTICS[statistic](valuesOf(rows, metric));
      const realPoint = centre(target);
      const simPoint = centre(each.arm.rows);
      const zeroPoint = zero === -1 ? null : centre(sim[zero].arm.rows);
      const minus = (a: number | null, b: number | null) =>
        a === null || b === null ? null : a - b;
      const realD = realDraws[r].get(key(statistic, metric)) ?? [];
      const simD = simDraws[i].get(key(statistic, metric)) ?? [];
      const zeroD = zero === -1 ? [] : (simDraws[zero].get(key(statistic, metric)) ?? []);
      const gapDraws = simD.map((value, b) => value - realD[b]);
      const closedDraws =
        zero === -1
          ? []
          : gapDraws.map((gap, b) => closedShare(gap, zeroD[b] - realD[b]) ?? Number.NaN);
      return {
        gap: { value: minus(simPoint, realPoint), ci95: interval(gapDraws) },
        closed: {
          value: closedShare(minus(simPoint, realPoint), minus(zeroPoint, realPoint)),
          ci95: interval(closedDraws),
        },
      };
    };
    const gaps = Object.fromEntries(
      real.map((target, r) => [
        target.arm.database,
        Object.fromEntries(
          GAP_METRICS.map((metric) => [
            metric,
            {
              ...Object.fromEntries(
                STATISTIC_NAMES.map((statistic) => [
                  statistic,
                  gapOf(r, metric, statistic),
                ]),
              ),
              ks: ksStatistic(
                valuesOf(each.arm.rows, metric),
                valuesOf(target.arm.rows, metric),
              ),
            },
          ]),
        ),
      ]),
    ) as SimArmSummary["gaps"];
    return {
      mode: each.arm.mode,
      gridMs: each.arm.gridMs,
      recordings: clusterCount(each.clusters),
      windows: each.arm.rows.length,
      centres: centresOf(each.arm.rows, simDraws[i]),
      gaps,
    };
  });
  return { sim: simSummaries, real: realSummaries };
};

export type RrGridArgs = Readonly<{
  out: string;
  afdb: string;
  ltafdb: string;
  seeds: number;
  resamples: number;
  bootstrapSeed: number;
}>;

export const USAGE = `usage: bun run rhythm-bench:rr-grid -- --out ${RHYTHM_BENCH_DIR}/rr-grid-<run> --afdb <dir> --ltafdb <dir> [--seeds N] [--resamples N] [--bootstrap-seed N]`;

/** Command-line arguments of `bun run rhythm-bench:rr-grid`. Both databases are needed. */
export const parseRrGridArgs = (argv: readonly string[]): RrGridArgs => {
  const known = new Set([
    "--out",
    "--afdb",
    "--ltafdb",
    "--seeds",
    "--resamples",
    "--bootstrap-seed",
  ]);
  const unknown = argv.filter((arg) => arg.startsWith("--") && !known.has(arg));
  if (unknown.length > 0) throw new Error(`unknown option ${unknown[0]}\n${USAGE}`);
  const valueOf = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${name} needs a value\n${USAGE}`);
    return value;
  };
  const required = (name: string): string => {
    const value = valueOf(name);
    if (value === undefined) throw new Error(`${name} is required\n${USAGE}`);
    return value;
  };
  const integer = (name: string, fallback: number, min: number): number => {
    const raw = valueOf(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min)
      throw new Error(`${name} must be an integer of at least ${min}`);
    return value;
  };
  return {
    out: required("--out"),
    afdb: required("--afdb"),
    ltafdb: required("--ltafdb"),
    seeds: integer("--seeds", DEFAULT_SEEDS, 1),
    resamples: integer("--resamples", DEFAULT_RESAMPLES, 0),
    bootstrapSeed: integer("--bootstrap-seed", DEFAULT_BOOTSTRAP_SEED, 0),
  };
};

export const STUDY_MODES: readonly AfDependence[] = AF_DEPENDENCES;

const fixed = (value: number | null, digits: number): string =>
  value === null ? "n/a" : value.toFixed(digits);

const withInterval = (estimate: Estimate, digits: number): string =>
  `${fixed(estimate.value, digits)} [${fixed(estimate.ci95.low, digits)}, ${fixed(estimate.ci95.high, digits)}]`;

/** A markdown table of one statistic for the console and report.md. */
export const studyTable = (result: StudyResult, statistic: StatisticName): string => {
  const columns: readonly [StudyMetric, string, number][] = [
    ["tpr", "TPR", 4],
    ["tpr_non_strict", "TPR, non-strict", 4],
    ["tpr_ties_broken", "TPR, ties broken", 4],
    ["sample_entropy", "SampEn", 3],
    ["tie_share", "Tied neighbours", 4],
  ];
  const line = (source: string, grid: string, windows: number, centres: Centres) =>
    `| ${[source, grid, String(windows), ...columns.map(([metric, , digits]) => withInterval(centres[statistic][metric], digits))].join(" | ")} |`;
  return [
    `| Source | Grid, ms | Windows | ${columns.map(([, label]) => `${label} (${statistic})`).join(" | ")} |`,
    `| ${Array.from({ length: columns.length + 3 }, () => "---").join(" | ")} |`,
    ...result.real.map((arm) => line(arm.database, "database", arm.windows, arm.centres)),
    ...result.sim.map((arm) =>
      line(`sim ${arm.mode}`, String(arm.gridMs), arm.windows, arm.centres),
    ),
  ].join("\n");
};
