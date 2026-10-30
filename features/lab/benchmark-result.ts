import { z } from "zod";

import { type CsvCell, toCsv } from "@/infrastructure/csv";
import { EMPTY_VALUE, formatDate, formatNumber } from "@/infrastructure/format-measure";

import { type EvidenceTable, plural } from "./lab-check";

/**
 * The rhythm benchmark's `result.json` (#249, `scripts/rhythm-bench/`) as the
 * Lab's Results section shows it. The benchmark writes the file; this only
 * reads the parts the page shows, leniently, so a later field does not break
 * the page. `benchmark-result.test.ts` runs the benchmark itself on a small
 * grid and parses its output, so the two stay in step. Pure.
 */

const interval = z.object({ low: z.number().nullable(), high: z.number().nullable() });
const estimate = z.object({ value: z.number().nullable(), ci95: interval });
const proportion = estimate.extend({ k: z.number(), n: z.number() });

export const BENCH_METRICS = [
  "nrmssd",
  "turning_point_ratio",
  "shannon_entropy",
  "sample_entropy",
] as const;

const summary = z.object({
  key: z.string(),
  nWindows: z.number(),
  nClusters: z.number(),
  nPositive: z.number(),
  nNegative: z.number(),
  nMixed: z.number(),
  sensitivity: proportion,
  specificity: proportion,
  auroc: z.object(
    Object.fromEntries(BENCH_METRICS.map((metric) => [metric, estimate])) as Record<
      (typeof BENCH_METRICS)[number],
      typeof estimate
    >,
  ),
});

const distance = z.object({
  quantity: z.string(),
  nSim: z.number(),
  nReal: z.number(),
  wasserstein1: z.number().nullable(),
  wasserstein1InRealSd: z.number().nullable(),
  ks: z.number().nullable(),
  simMedian: z.number().nullable(),
  realMedian: z.number().nullable(),
});

const resultSchema = z.object({
  generatedAt: z.string().optional(),
  benchmark: z.literal("rhythm-bench"),
  runId: z.string(),
  gitSha: z.string().optional(),
  options: z.object({ seeds: z.number(), resamples: z.number() }),
  simulated: z.object({
    recordings: z.number(),
    windows: z.number(),
    overall: summary,
    pureOnly: summary,
    byDuration: z.array(summary),
    byRhythm: z.array(summary),
    byAfRate: z.array(summary),
    byNoise: z.array(summary),
  }),
  real: z
    .object({
      database: z.string(),
      records: z.array(z.unknown()),
      overall: summary,
      pureOnly: summary,
      byDominantRhythm: z.array(summary),
    })
    .nullable(),
  simToReal: z.array(
    z.object({
      noise: z.string(),
      simClass: z.string(),
      realClass: z.string(),
      distances: z.array(distance),
    }),
  ),
});

export type BenchmarkResult = z.infer<typeof resultSchema>;
type Summary = z.infer<typeof summary>;

export type BenchmarkRead =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; result: BenchmarkResult }>;

/** A result.json's text as a result, or `unreadable` when it is not that shape. */
export const parseBenchmark = (text: string | null): BenchmarkRead => {
  if (text === null) return { kind: "missing" };
  try {
    const parsed = resultSchema.safeParse(JSON.parse(text));
    return parsed.success
      ? { kind: "found", result: parsed.data }
      : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
};

/** The newest of several runs: by `generatedAt`, then by folder name. */
export const newestRun = <T extends Readonly<{ dir: string; read: BenchmarkRead }>>(
  runs: readonly T[],
): T | null =>
  [...runs].sort((a, b) => {
    const at = (run: T) =>
      run.read.kind === "found" ? (run.read.result.generatedAt ?? "") : "";
    return at(b).localeCompare(at(a)) || b.dir.localeCompare(a.dir);
  })[0] ?? null;

/** One table of the page, with its CSV. */
export type BenchTable = Readonly<{ table: EvidenceTable; csv: string; slug: string }>;

const GROUP_LABEL: Readonly<Record<string, string>> = {
  sim: "All windows",
  "sim pure": "Windows of one rhythm only",
  real: "All windows",
  "real pure": "Windows of one rhythm only",
};

/** "duration=30s" reads "duration 30s"; the overall rows get a name. */
const groupText = (key: string, pure: boolean): string =>
  pure ? "Windows of one rhythm only" : (GROUP_LABEL[key] ?? key.replace("=", " "));

const ratio = (value: number | null): string => formatNumber(value, 3);

const withCi = (item: z.infer<typeof estimate>): string =>
  item.value === null
    ? EMPTY_VALUE
    : `${ratio(item.value)} (${ratio(item.ci95.low)}–${ratio(item.ci95.high)})`;

const SUMMARY_COLUMNS = [
  "Group",
  "Windows",
  "AF",
  "Not AF",
  "Mixed",
  "Sensitivity (95 % CI)",
  "Specificity (95 % CI)",
  "AUROC nRMSSD",
  "AUROC turning-point ratio",
  "AUROC Shannon entropy",
  "AUROC sample entropy",
] as const;

const SUMMARY_CSV = [
  "group",
  "windows",
  "af",
  "not_af",
  "mixed",
  ...["sensitivity", "specificity", ...BENCH_METRICS.map((m) => `auroc_${m}`)].flatMap(
    (name) => [name, `${name}_ci95_low`, `${name}_ci95_high`],
  ),
];

type Row = Readonly<{ summary: Summary; pure: boolean }>;

const summaryRows = (
  overall: Summary,
  pure: Summary,
  groups: readonly Summary[],
): Row[] => [
  { summary: overall, pure: false },
  { summary: pure, pure: true },
  ...groups.map((each) => ({ summary: each, pure: false })),
];

const estimatesOf = (each: Summary) => [
  each.sensitivity,
  each.specificity,
  ...BENCH_METRICS.map((metric) => each.auroc[metric]),
];

const summaryTable = (
  caption: string,
  slug: string,
  rows: readonly Row[],
): BenchTable => ({
  slug,
  table: {
    caption,
    columns: SUMMARY_COLUMNS,
    rows: rows.map(({ summary: each, pure }) => [
      groupText(each.key, pure),
      formatNumber(each.nWindows, 0),
      formatNumber(each.nPositive, 0),
      formatNumber(each.nNegative, 0),
      formatNumber(each.nMixed, 0),
      ...estimatesOf(each).map(withCi),
    ]),
  },
  csv: toCsv(
    SUMMARY_CSV,
    rows.map(({ summary: each, pure }): readonly CsvCell[] => [
      groupText(each.key, pure),
      each.nWindows,
      each.nPositive,
      each.nNegative,
      each.nMixed,
      ...estimatesOf(each).flatMap((item) => [item.value, item.ci95.low, item.ci95.high]),
    ]),
  ),
});

const QUANTITY_LABEL: Readonly<Record<string, string>> = {
  nrmssd: "nRMSSD",
  turning_point_ratio: "Turning-point ratio",
  shannon_entropy: "Shannon entropy",
  sample_entropy: "Sample entropy",
  mean_rr_ms: "Window mean RR (ms)",
  rr_ms: "RR interval (ms)",
};

const distanceTable = (result: BenchmarkResult): BenchTable => {
  const rows = result.simToReal.flatMap((pair) =>
    pair.distances.map((each) => ({ pair, each })),
  );
  return {
    slug: "sim-to-real",
    table: {
      caption: "Simulated against database windows",
      columns: [
        "Quantity",
        "Noise",
        "Simulated",
        "Database",
        "n sim / real",
        "W1 / real SD",
        "KS",
        "Median sim",
        "Median real",
      ],
      rows: rows.map(({ pair, each }) => [
        QUANTITY_LABEL[each.quantity] ?? each.quantity,
        pair.noise,
        pair.simClass,
        pair.realClass,
        `${formatNumber(each.nSim, 0)} / ${formatNumber(each.nReal, 0)}`,
        ratio(each.wasserstein1InRealSd),
        ratio(each.ks),
        ratio(each.simMedian),
        ratio(each.realMedian),
      ]),
    },
    csv: toCsv(
      [
        "quantity",
        "noise",
        "sim_class",
        "real_class",
        "n_sim",
        "n_real",
        "wasserstein1",
        "wasserstein1_in_real_sd",
        "ks",
        "sim_median",
        "real_median",
      ],
      rows.map(({ pair, each }): readonly CsvCell[] => [
        each.quantity,
        pair.noise,
        pair.simClass,
        pair.realClass,
        each.nSim,
        each.nReal,
        each.wasserstein1,
        each.wasserstein1InRealSd,
        each.ks,
        each.simMedian,
        each.realMedian,
      ]),
    ),
  };
};

/** The tables the page shows for one run, in order. */
export const benchmarkTables = (result: BenchmarkResult): readonly BenchTable[] => {
  const sim = result.simulated;
  return [
    summaryTable(
      "Research flag and metrics on simulated windows (simulator labels)",
      "simulated",
      summaryRows(sim.overall, sim.pureOnly, [
        ...sim.byDuration,
        ...sim.byRhythm,
        ...sim.byAfRate,
        ...sim.byNoise,
      ]),
    ),
    ...(result.real === null
      ? []
      : [
          summaryTable(
            `Research flag and metrics on ${result.real.database} (reference annotations)`,
            "database",
            summaryRows(
              result.real.overall,
              result.real.pureOnly,
              result.real.byDominantRhythm,
            ),
          ),
        ]),
    ...(result.simToReal.length === 0 ? [] : [distanceTable(result)]),
  ];
};

/** One line about the run: id, date, seeds, resamples, records. */
export const benchmarkRunLine = (result: BenchmarkResult): string =>
  [
    `Run ${result.runId}`,
    ...(result.generatedAt === undefined
      ? []
      : [formatDate(result.generatedAt.slice(0, 10))]),
    `${plural(result.options.seeds, "seed")} per cell`,
    `${formatNumber(result.options.resamples, 0)} bootstrap resamples`,
    `${formatNumber(result.simulated.windows, 0)} simulated windows`,
    ...(result.real === null
      ? ["no database"]
      : [plural(result.real.records.length, "database record")]),
    ...(result.gitSha === undefined ? [] : [`git ${result.gitSha.slice(0, 12)}`]),
  ].join(" · ");
