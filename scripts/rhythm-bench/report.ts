/**
 * Markdown report and figure-ready CSVs of a benchmark run. Pure: it returns
 * strings; the CLI writes them.
 */
import { type AurocEstimate, type ProportionEstimate, type Summary } from "./analysis";
import {
  AFDB_AF_LABEL,
  type BenchmarkData,
  type BenchmarkResult,
  type DistanceTable,
} from "./benchmark";
import { DATABASES } from "./databases";
import { type RealNoiseLevel } from "./real-noise";
import { QUANTITIES, valuesOf } from "./distance";
import { quantileSorted, rocPoints } from "./statistics";
import { METRICS, type MetricName, WINDOW_BEATS, type WindowRow } from "./windows";

export const METRIC_LABELS: Readonly<Record<MetricName, string>> = {
  nrmssd: "nRMSSD",
  turning_point_ratio: "TPR",
  shannon_entropy: "ShEn",
  sample_entropy: "SampEn",
};

export const fixed = (value: number | null, digits = 3): string =>
  value === null ? "n/a" : value.toFixed(digits);

export const withCi = (
  estimate: Readonly<{
    value: number | null;
    ci95: { low: number | null; high: number | null };
  }>,
): string =>
  estimate.value === null
    ? "n/a"
    : estimate.ci95.low === null || estimate.ci95.high === null
      ? fixed(estimate.value)
      : `${fixed(estimate.value)} [${fixed(estimate.ci95.low)}, ${fixed(estimate.ci95.high)}]`;

const proportionCell = (estimate: ProportionEstimate): string =>
  estimate.n === 0 ? "n/a" : `${withCi(estimate)} (${estimate.k}/${estimate.n})`;

const aurocCell = (estimate: AurocEstimate): string => withCi(estimate);

const table = (
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
): string =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

export const summaryTable = (summaries: readonly Summary[]): string =>
  table(
    [
      "Subset",
      "Windows",
      "Clusters",
      "AF / not AF",
      "Mixed",
      "Sensitivity [95 % CI]",
      "Specificity [95 % CI]",
      ...METRICS.map((metric) => `AUROC ${METRIC_LABELS[metric]}`),
    ],
    summaries.map((summary) => [
      summary.key,
      `${summary.nWindows}`,
      `${summary.nClusters}`,
      `${summary.nPositive} / ${summary.nNegative}`,
      `${summary.nMixed}`,
      proportionCell(summary.sensitivity),
      proportionCell(summary.specificity),
      ...METRICS.map((metric) => aurocCell(summary.auroc[metric])),
    ]),
  );

const distanceTable = (tables: readonly DistanceTable[]): string =>
  table(
    [
      "Sim class",
      "Real class",
      "Quantity",
      "Sim median",
      "Real median",
      "W1",
      "W1 / real SD",
      "KS",
    ],
    tables.flatMap((each) =>
      each.distances.map((distance) => [
        each.simClass,
        each.realClass,
        distance.quantity,
        fixed(distance.simMedian),
        fixed(distance.realMedian),
        fixed(distance.wasserstein1),
        fixed(distance.wasserstein1InRealSd, 2),
        fixed(distance.ks, 2),
      ]),
    ),
  );

/** The largest sim-to-real gaps by KS statistic, noise level "none". */
export const largestGaps = (
  tables: readonly DistanceTable[],
  count: number,
): Array<
  Readonly<{
    simClass: string;
    realClass: string;
    quantity: string;
    ks: number;
    w1Sd: number | null;
  }>
> =>
  tables
    .filter((each) => each.noise === "none")
    .flatMap((each) =>
      each.distances
        .filter((distance) => distance.ks !== null)
        .map((distance) => ({
          simClass: each.simClass,
          realClass: each.realClass,
          quantity: distance.quantity,
          ks: distance.ks ?? 0,
          w1Sd: distance.wasserstein1InRealSd,
        })),
    )
    .sort((a, b) => b.ks - a.ks || a.quantity.localeCompare(b.quantity))
    .slice(0, count);

const realSection = (real: NonNullable<BenchmarkResult["real"]>): string[] => [
  `## Open recordings: ${real.database}`,
  "",
  `${real.database}. SHA-256 of its SHA256SUMS.txt: \`${real.sha256SumsFile ?? "not read"}\`. ${DATABASES[real.databaseId].annotationNote} Intervals before the first rhythm annotation are left out, and an interval over 3 s splits the series (a gap, not a beat).`,
  "",
  table(
    [
      "Record",
      "Beats from",
      "Signal file",
      "Windows",
      "AF windows (flagged)",
      "Not-AF windows (flagged)",
      "Intervals by rhythm",
    ],
    real.records.map((record) => [
      record.record,
      record.beatAnnotator,
      record.hasSignalFile ? "yes" : "no",
      `${record.windows}`,
      `${record.afWindows} (${record.flaggedAfWindows})`,
      `${record.nonAfWindows} (${record.flaggedNonAfWindows})`,
      Object.entries(record.rhythmIntervals)
        .map(([rhythm, count]) => `${rhythm} ${count}`)
        .join(", "),
    ]),
  ),
  "",
  summaryTable([real.overall, real.pureOnly, ...real.byDominantRhythm]),
  "",
  nullLine(real.overall),
  "",
];

const nullLine = (summary: Summary): string =>
  `Sample entropy undefined (no template match) in ${summary.auroc.sample_entropy.nullPositive} AF and ${summary.auroc.sample_entropy.nullNegative} not-AF windows.`;

/** The simulated summaries a noise level is read against: the whole grid, and the longest recordings. */
export const simulatedForNoise = (
  result: BenchmarkResult,
  noise: string,
): Readonly<{ grid: Summary | null; longest: Summary | null }> => {
  const longest = Math.max(...result.options.grid.durations);
  return {
    grid: result.simulated.byNoise.find((each) => each.key === `noise=${noise}`) ?? null,
    longest:
      result.simulated.byDurationAndNoise.find(
        (each) => each.key === `duration×noise=${longest}s×${noise}`,
      ) ?? null,
  };
};

const optionalProportion = (
  summary: Summary | null,
  which: "sensitivity" | "specificity",
) => (summary === null ? "n/a" : proportionCell(summary[which]));

const share = (part: number, whole: number): string =>
  whole === 0 ? "n/a" : `${part} (${((100 * part) / whole).toFixed(2)} %)`;

const realNoiseSection = (result: BenchmarkResult): string[] => {
  const levels: readonly RealNoiseLevel[] = result.realNoise ?? [];
  return [
    "## Beat-detection noise on database beats",
    "",
    "The grid's noise levels applied to the annotated beats of every record (seeded per record and segment), then the same windows and flag. Clusters for the bootstrap are records. Simulated columns are the whole grid and the longest recordings at the same level. Missed and spurious are beats removed and inserted, as a share of the annotated beats.",
    "",
    table(
      [
        "Noise",
        "Beats",
        "Missed",
        "Spurious",
        "Windows (AF / not AF)",
        "Real sensitivity [95 % CI]",
        "Real specificity [95 % CI]",
        "Sim sensitivity",
        "Sim specificity",
        "Sim specificity, longest",
      ],
      levels.map((level) => {
        const sim = simulatedForNoise(result, level.noise);
        return [
          level.noise,
          `${level.beats}`,
          share(level.missed, level.beats),
          share(level.spurious, level.beats),
          `${level.summary.nWindows} (${level.summary.nPositive} / ${level.summary.nNegative})`,
          proportionCell(level.summary.sensitivity),
          proportionCell(level.summary.specificity),
          optionalProportion(sim.grid, "sensitivity"),
          optionalProportion(sim.grid, "specificity"),
          optionalProportion(sim.longest, "specificity"),
        ];
      }),
    ),
    "",
    "AUROC by level:",
    "",
    summaryTable(levels.map((level) => level.summary)),
    "",
  ];
};

/** Lag autocorrelation of ln RR in all-AF windows, simulated and real (#297). */
export const afDependenceSection = (result: BenchmarkResult): string[] => [
  "## Short-range dependence of AF intervals",
  "",
  `Simulated AF mode \`${result.options.afDependence}\`. Sample autocorrelation of ln RR at each lag in full ${WINDOW_BEATS}-interval windows whose intervals are all AF (simulated, noise none) or all ${AFDB_AF_LABEL} (database). Per-record is the median over records (recordings) of each one's median; independent values give about -0.008 at lag 1 in windows this long.`,
  "",
  table(
    [
      "Lag",
      "Sim windows",
      "Sim pooled median",
      "Sim per-recording median",
      "Real windows (records)",
      "Real pooled median",
      "Real per-record median",
    ],
    result.afDependence.map(({ sim, real }) => [
      `${sim.lag}`,
      `${sim.windows}`,
      fixed(sim.pooledMedian),
      fixed(sim.medianOfClusterMedians),
      real === null ? "n/a" : `${real.windows} (${real.clusters})`,
      fixed(real?.pooledMedian ?? null),
      fixed(real?.medianOfClusterMedians ?? null),
    ]),
  ),
  "",
];

export const markdownReport = (result: BenchmarkResult, generatedAt: string): string => {
  const sim = result.simulated;
  const gaps = largestGaps(result.simToReal, 8);
  return [
    "# Rhythm benchmark",
    "",
    `Run \`${result.runId}\`, git \`${result.gitSha}\`, ${generatedAt}. Benchmark version ${result.version}; ${result.options.seeds} seeds per grid cell; ${result.options.resamples} cluster-bootstrap resamples (seed ${result.options.bootstrapSeed}); simulated AF intervals \`${result.options.afDependence}\`.`,
    "",
    "Research use only. It describes recordings and methods, never a person.",
    "",
    `Windows: ${result.options.windowBeats} RR intervals; ${result.options.afWindowRule}. Flag: nRMSSD above 0.1 and turning-point ratio in the 99.9 % band of independent values (Dash et al. 2009 without their entropy condition), from \`irregularityWindow\`. AUROC is P(score in an AF window > score in a not-AF window); below 0.5 means the metric is lower in AF. Sample entropy is null where no template matches; those windows are left out of its AUROC.`,
    "",
    "## Simulated recordings",
    "",
    `${sim.recordings} recordings, ${sim.windows} windows. Clusters for the bootstrap are recordings.`,
    "",
    summaryTable([sim.overall, sim.pureOnly]),
    "",
    nullLine(sim.overall),
    "",
    "### By recording length",
    "",
    summaryTable(sim.byDuration),
    "",
    "### By rhythm",
    "",
    summaryTable(sim.byRhythm),
    "",
    "### By ventricular rate in AF (AF conditions only)",
    "",
    summaryTable(sim.byAfRate),
    "",
    "### By beat-detection noise",
    "",
    summaryTable(sim.byNoise),
    "",
    "### By length and noise",
    "",
    summaryTable(sim.byDurationAndNoise),
    "",
    ...(result.real === null
      ? ["No database given (`--afdb` or `--ltafdb`), real part skipped.", ""]
      : realSection(result.real)),
    ...(result.realNoise === null ? [] : realNoiseSection(result)),
    ...afDependenceSection(result),
    "## Simulated against real",
    "",
    ...(result.simToReal.length === 0
      ? ["Needs the database.", ""]
      : [
          `Simulated ${WINDOW_BEATS}-interval windows with every interval AF (or none AF) against database windows with every interval ${AFDB_AF_LABEL} (or N). Noise level none:`,
          "",
          distanceTable(result.simToReal.filter((each) => each.noise === "none")),
          "",
          "Largest gaps (KS, noise none):",
          "",
          table(
            ["Sim class", "Real class", "Quantity", "KS", "W1 / real SD"],
            gaps.map((gap) => [
              gap.simClass,
              gap.realClass,
              gap.quantity,
              fixed(gap.ks, 2),
              fixed(gap.w1Sd, 2),
            ]),
          ),
          "",
          "KS by noise level:",
          "",
          table(
            [
              "Sim class",
              "Quantity",
              ...result.options.grid.noise.map((noise) => noise.id),
            ],
            result.simToReal
              .filter((each) => each.noise === "none")
              .flatMap((each) =>
                each.distances.map((distance) => [
                  each.simClass,
                  distance.quantity,
                  ...result.options.grid.noise.map((noise) =>
                    fixed(
                      result.simToReal
                        .find(
                          (other) =>
                            other.noise === noise.id && other.simClass === each.simClass,
                        )
                        ?.distances.find((d) => d.quantity === distance.quantity)?.ks ??
                        null,
                      2,
                    ),
                  ),
                ]),
              ),
          ),
          "",
        ]),
  ].join("\n");
};

const csv = (
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
): string =>
  [
    header.join(","),
    ...rows.map((row) => row.map((cell) => (cell === null ? "" : `${cell}`)).join(",")),
  ].join("\n") + "\n";

const metricCells = (row: WindowRow): Array<number | null> =>
  METRICS.map((metric) => row.metrics[metric]);

export const simWindowsCsv = (data: BenchmarkData): string =>
  csv(
    [
      "cluster",
      "duration_sec",
      "rhythm",
      "af_rate",
      "noise",
      "seed",
      "index",
      "n",
      "mean_rr_ms",
      "af_share",
      "positive",
      "flagged",
      ...METRICS,
    ],
    data.simRows.map((row) => [
      row.cluster,
      row.durationSec,
      row.rhythm,
      row.afRate,
      row.noise,
      row.seed,
      row.index,
      row.n,
      row.meanRrMs,
      row.afShare,
      row.positive,
      row.flagged,
      ...metricCells(row),
    ]),
  );

export const realWindowsCsv = (data: BenchmarkData): string =>
  csv(
    [
      "record",
      "index",
      "n",
      "mean_rr_ms",
      "af_share",
      "dominant",
      "single_label",
      "positive",
      "flagged",
      ...METRICS,
    ],
    data.realRows.map((row) => [
      row.record,
      row.index,
      row.n,
      row.meanRrMs,
      row.afShare,
      row.dominant,
      row.singleLabel,
      row.positive,
      row.flagged,
      ...metricCells(row),
    ]),
  );

const estimateCells = (estimate: ProportionEstimate) => [
  estimate.value,
  estimate.ci95.low,
  estimate.ci95.high,
  estimate.k,
  estimate.n,
];

/** Sensitivity and specificity per noise level, database and simulated, for a figure. */
export const realNoiseCsv = (result: BenchmarkResult): string =>
  csv(
    [
      "source",
      "noise",
      "windows",
      "clusters",
      "beats",
      "missed",
      "spurious",
      "sensitivity",
      "sensitivity_low",
      "sensitivity_high",
      "sensitivity_k",
      "sensitivity_n",
      "specificity",
      "specificity_low",
      "specificity_high",
      "specificity_k",
      "specificity_n",
    ],
    (result.realNoise ?? []).flatMap((level) => {
      const sim = simulatedForNoise(result, level.noise);
      const row = (
        source: string,
        summary: Summary,
        counts: readonly [number | null, number | null, number | null],
      ) => [
        source,
        level.noise,
        summary.nWindows,
        summary.nClusters,
        ...counts,
        ...estimateCells(summary.sensitivity),
        ...estimateCells(summary.specificity),
      ];
      return [
        row("real", level.summary, [level.beats, level.missed, level.spurious]),
        ...(sim.grid === null ? [] : [row("sim", sim.grid, [null, null, null])]),
        ...(sim.longest === null
          ? []
          : [row("sim-longest", sim.longest, [null, null, null])]),
      ];
    }),
  );

export const realNoiseWindowsCsv = (data: BenchmarkData): string =>
  csv(
    [
      "record",
      "noise",
      "index",
      "n",
      "mean_rr_ms",
      "af_share",
      "dominant",
      "single_label",
      "positive",
      "flagged",
      ...METRICS,
    ],
    data.realNoiseRows.map((row) => [
      row.record,
      row.noise,
      row.index,
      row.n,
      row.meanRrMs,
      row.afShare,
      row.dominant,
      row.singleLabel,
      row.positive,
      row.flagged,
      ...metricCells(row),
    ]),
  );

const scores = (
  rows: readonly WindowRow[],
  metric: MetricName,
  positive: boolean,
): number[] =>
  rows
    .filter((row) => row.positive === positive)
    .map((row) => row.metrics[metric])
    .filter((value): value is number => value !== null);

export const rocCsv = (data: BenchmarkData): string => {
  const sources: ReadonlyArray<readonly [string, readonly WindowRow[]]> = [
    ["sim", data.simRows],
    ["sim-128", data.simRows.filter((row) => row.n === WINDOW_BEATS)],
    ["real", data.realRows],
  ];
  return csv(
    ["source", "metric", "threshold", "fpr", "tpr"],
    sources.flatMap(([source, rows]) =>
      METRICS.flatMap((metric) =>
        rocPoints(scores(rows, metric, true), scores(rows, metric, false)).map(
          (point) => [
            source,
            metric,
            Number.isFinite(point.threshold) ? point.threshold : "inf",
            point.fpr,
            point.tpr,
          ],
        ),
      ),
    ),
  );
};

const PERCENTS = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);

/** Percentiles 1 to 99 of every quantity, per source, class and noise level. */
export const distributionCsv = (data: BenchmarkData): string => {
  const simFull = data.simRows.filter((row) => row.n === WINDOW_BEATS);
  const noises = [...new Set(simFull.map((row) => row.noise))];
  const groups: ReadonlyArray<readonly [string, string, string, readonly WindowRow[]]> = [
    ...noises.flatMap((noise) => [
      [
        "sim",
        "af",
        noise,
        simFull.filter((row) => row.noise === noise && row.afShare === 1),
      ] as const,
      [
        "sim",
        "not-af",
        noise,
        simFull.filter((row) => row.noise === noise && row.afShare === 0),
      ] as const,
    ]),
    ...[...new Set(data.realRows.map((row) => row.dominant))]
      .sort()
      .map(
        (rhythm) =>
          [
            "real",
            rhythm,
            "",
            data.realRows.filter((row) => row.singleLabel && row.dominant === rhythm),
          ] as const,
      ),
  ];
  return csv(
    ["source", "class", "noise", "quantity", "percentile", "value"],
    groups.flatMap(([source, group, noise, rows]) =>
      QUANTITIES.flatMap((quantity) => {
        const sorted = valuesOf(rows, quantity).sort((a, b) => a - b);
        return sorted.length === 0
          ? []
          : PERCENTS.map((p) => [
              source,
              group,
              noise,
              quantity,
              Math.round(p * 100),
              quantileSorted(sorted, p),
            ]);
      }),
    ),
  );
};
