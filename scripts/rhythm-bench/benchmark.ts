/**
 * The rhythm benchmark as one pure function: simulated windows with the
 * simulator's labels, windows of the annotated database records (already
 * parsed by the caller), the same metrics and statistics on both, and the
 * distance between them. The caller does the file reading, the git sha and
 * the clock; everything here depends only on its inputs.
 *
 * It describes recordings and methods. Nothing here is about a person.
 */
import { createHash } from "node:crypto";

import { randomFor } from "@/infrastructure/seeded-random";
import { type AfDependence } from "@/packages/rhythm-sim/af-interval";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import { DEPENDENCE_LAGS, type LagSummary, lagSummary } from "./af-dependence";

import { labelledSegments } from "./afdb-series";
import { type BeatAnnotator, DATABASES, type DatabaseId } from "./databases";
import { type Summary, summarise, summariseBy } from "./analysis";
import { type Distance, distances } from "./distance";
import { type RhythmChange } from "./mit-annotations";
import { intervalsOf, perturbBeats } from "./perturb";
import { type RealNoiseLevel, realNoiseLevels, type RealNoiseRow } from "./real-noise";
import {
  cellId,
  type GridCell,
  gridCells,
  type GridOptions,
  recordingConfigForCell,
  recordingSeed,
} from "./sim-grid";
import { isMixed, labelledWindows, WINDOW_BEATS, type WindowRow } from "./windows";

export const BENCHMARK_VERSION = 1;

export type SimWindowRow = WindowRow &
  Readonly<{
    durationSec: number;
    rhythm: string;
    afRate: number | null;
    noise: string;
    seed: number;
  }>;

export type AfdbRecordInput = Readonly<{
  record: string;
  /** Which annotation file the beats were read from (`DATABASES[...].beatSources`). */
  beatAnnotator: BeatAnnotator;
  samplingHz: number;
  hasSignalFile: boolean;
  beats: readonly number[];
  rhythmChanges: readonly RhythmChange[];
}>;

export type BenchmarkOptions = Readonly<{
  seeds: number;
  bootstrapSeed: number;
  resamples: number;
  grid: GridOptions;
  /** Also apply the grid's noise levels to the database beats (#296); needs the database. */
  realNoise?: boolean;
  /**
   * How simulated AF intervals depend on each other (#297). Left out means
   * independent, and keeps the run id of runs from before the option.
   */
  afDependence?: AfDependence;
}>;

/**
 * AF in both databases is "(AFIB"; every other rhythm (sinus, atrial flutter,
 * junctional, bigeminy, SVTA, ...) counts as not AF.
 */
export const AFDB_AF_LABEL = "AFIB";

const simIsAf = (label: string): boolean => label === "af";
const realIsAf = (label: string): boolean => label === AFDB_AF_LABEL;

export const simulateCellWindows = (
  cell: GridCell,
  seed: number,
  afDependence: AfDependence = "independent",
): SimWindowRow[] => {
  const recording = simulateRecording(recordingConfigForCell(cell, seed, afDependence));
  const perturbed = perturbBeats(
    { beatTimesMs: recording.beatTimesMs, labels: recording.labels },
    cell.noise,
    randomFor(recordingSeed(cell, seed), `perturb:${cell.noise.id}`),
  );
  const rr = intervalsOf(perturbed.beatTimesMs);
  return labelledWindows(
    `${cellId(cell)}|${seed}`,
    rr,
    perturbed.labels,
    simIsAf,
    true,
  ).map((row) => ({
    ...row,
    durationSec: cell.durationSec,
    rhythm: cell.rhythm.id,
    afRate: cell.afRate,
    noise: cell.noise.id,
    seed,
  }));
};

export const simulatedWindows = (options: BenchmarkOptions): SimWindowRow[] =>
  gridCells(options.grid).flatMap((cell) =>
    Array.from({ length: options.seeds }, (_, seed) =>
      simulateCellWindows(cell, seed, options.afDependence),
    ).flat(),
  );

export type RealWindowRow = WindowRow & Readonly<{ record: string }>;

export type RecordSummary = Readonly<{
  record: string;
  beatAnnotator: BeatAnnotator;
  hasSignalFile: boolean;
  samplingHz: number;
  beats: number;
  intervalsUsed: number;
  segments: number;
  windows: number;
  afWindows: number;
  flaggedAfWindows: number;
  nonAfWindows: number;
  flaggedNonAfWindows: number;
  /** Intervals per reference rhythm, in the windows. */
  rhythmIntervals: Readonly<Record<string, number>>;
}>;

export const recordWindows = (input: AfdbRecordInput): RealWindowRow[] => {
  // Appended in place: a 24 h record has hundreds of segments, and copying the
  // rows for each would be quadratic.
  const out: RealWindowRow[] = [];
  for (const segment of labelledSegments(
    input.beats,
    input.rhythmChanges,
    input.samplingHz,
  )) {
    const rows = labelledWindows(
      input.record,
      segment.rrMs,
      segment.rhythms,
      realIsAf,
      false,
      out.length,
    );
    for (const row of rows) out.push({ ...row, record: input.record });
  }
  return out;
};

const recordSummary = (
  input: AfdbRecordInput,
  rows: readonly RealWindowRow[],
): RecordSummary => {
  const segments = labelledSegments(input.beats, input.rhythmChanges, input.samplingHz);
  const rhythmIntervals = segments
    .flatMap((segment) => beatWindowsLabels(segment.rhythms))
    .reduce<Record<string, number>>(
      (tally, label) => ({ ...tally, [label]: (tally[label] ?? 0) + 1 }),
      {},
    );
  return {
    record: input.record,
    beatAnnotator: input.beatAnnotator,
    hasSignalFile: input.hasSignalFile,
    samplingHz: input.samplingHz,
    beats: input.beats.length,
    intervalsUsed: rows.length * WINDOW_BEATS,
    segments: segments.length,
    windows: rows.length,
    afWindows: rows.filter((row) => row.positive).length,
    flaggedAfWindows: rows.filter((row) => row.positive && row.flagged).length,
    nonAfWindows: rows.filter((row) => !row.positive).length,
    flaggedNonAfWindows: rows.filter((row) => !row.positive && row.flagged).length,
    rhythmIntervals: Object.fromEntries(Object.entries(rhythmIntervals).sort()),
  };
};

/** The labels that fall inside whole 128-interval windows. */
const beatWindowsLabels = (labels: readonly string[]): string[] =>
  labels.slice(0, Math.floor(labels.length / WINDOW_BEATS) * WINDOW_BEATS);

export type DistanceTable = Readonly<{
  noise: string;
  simClass: string;
  realClass: string;
  distances: readonly Distance[];
}>;

export type BenchmarkResult = Readonly<{
  benchmark: "rhythm-bench";
  version: number;
  runId: string;
  gitSha: string;
  options: Readonly<{
    seeds: number;
    bootstrapSeed: number;
    resamples: number;
    grid: GridOptions;
    realNoise: boolean;
    afDependence: AfDependence;
    windowBeats: number;
    afWindowRule: string;
  }>;
  simulated: Readonly<{
    recordings: number;
    windows: number;
    overall: Summary;
    pureOnly: Summary;
    byDuration: readonly Summary[];
    byRhythm: readonly Summary[];
    byAfRate: readonly Summary[];
    byNoise: readonly Summary[];
    byDurationAndNoise: readonly Summary[];
  }>;
  real: Readonly<{
    databaseId: DatabaseId;
    database: string;
    sha256SumsFile: string | null;
    records: readonly RecordSummary[];
    overall: Summary;
    pureOnly: Summary;
    byDominantRhythm: readonly Summary[];
  }> | null;
  simToReal: readonly DistanceTable[];
  /**
   * Autocorrelation of ln RR at lags 1 to 3 in full windows that are all AF:
   * simulated without noise, and the database's all-AFIB windows (#297).
   */
  afDependence: readonly Readonly<{ sim: LagSummary; real: LagSummary | null }>[];
  /** The grid's noise levels on the database beats, one summary per level; null unless asked. */
  realNoise: readonly RealNoiseLevel[] | null;
}>;

export type BenchmarkInputs = Readonly<{
  options: BenchmarkOptions;
  gitSha: string;
  afdb: Readonly<{
    /** Which database the records are from; the MIT-BIH AF Database when left out. */
    database?: DatabaseId;
    records: readonly AfdbRecordInput[];
    sha256SumsFile: string | null;
  }> | null;
}>;

export type BenchmarkData = Readonly<{
  result: BenchmarkResult;
  simRows: readonly SimWindowRow[];
  realRows: readonly RealWindowRow[];
  realNoiseRows: readonly RealNoiseRow[];
}>;

const pure = (row: WindowRow): boolean => !isMixed(row);

export const runIdOf = (inputs: BenchmarkInputs): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        version: BENCHMARK_VERSION,
        options: inputs.options,
        gitSha: inputs.gitSha,
        records: inputs.afdb?.records.map((record) => record.record) ?? null,
        sums: inputs.afdb?.sha256SumsFile ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 16);

export const runBenchmark = (inputs: BenchmarkInputs): BenchmarkData => {
  const { options } = inputs;
  const seed = options.bootstrapSeed;
  const resamples = options.resamples;
  const simRows = simulatedWindows(options);
  const realByRecord = (inputs.afdb?.records ?? []).map((record) => ({
    record,
    rows: recordWindows(record),
  }));
  const realRows = realByRecord.flatMap((entry) => entry.rows);
  const realNoise =
    inputs.afdb === null || options.realNoise !== true
      ? null
      : realNoiseLevels(inputs.afdb.records, options.grid.noise, resamples, seed);
  const simFull = simRows.filter((row) => row.n === WINDOW_BEATS);
  const simToReal: DistanceTable[] =
    inputs.afdb === null
      ? []
      : options.grid.noise.flatMap((noise) =>
          [
            { simClass: "af", realClass: AFDB_AF_LABEL, simAf: 1 },
            { simClass: "not-af", realClass: "N", simAf: 0 },
          ].map((pair) => ({
            noise: noise.id,
            simClass: pair.simClass,
            realClass: pair.realClass,
            distances: distances(
              simFull.filter(
                (row) => row.noise === noise.id && row.afShare === pair.simAf,
              ),
              realRows.filter(
                (row) => row.singleLabel && row.dominant === pair.realClass,
              ),
            ),
          })),
        );
  const simAfClean = simFull.filter((row) => row.noise === "none" && row.afShare === 1);
  const realAf = realRows.filter(
    (row) => row.singleLabel && row.dominant === AFDB_AF_LABEL,
  );
  const afDependence = DEPENDENCE_LAGS.map((lag) => ({
    sim: lagSummary(simAfClean, lag),
    real: inputs.afdb === null ? null : lagSummary(realAf, lag),
  }));
  return {
    simRows,
    realRows,
    realNoiseRows: realNoise?.rows ?? [],
    result: {
      benchmark: "rhythm-bench",
      version: BENCHMARK_VERSION,
      runId: runIdOf(inputs),
      gitSha: inputs.gitSha,
      options: {
        seeds: options.seeds,
        bootstrapSeed: options.bootstrapSeed,
        resamples: options.resamples,
        grid: options.grid,
        realNoise: realNoise !== null,
        afDependence: options.afDependence ?? "independent",
        windowBeats: WINDOW_BEATS,
        afWindowRule:
          "a window is AF when at least 50 % of its intervals are AF; simulated recordings shorter than 128 intervals are one window of all their intervals",
      },
      simulated: {
        recordings: gridCells(options.grid).length * options.seeds,
        windows: simRows.length,
        overall: summarise("sim", simRows, resamples, seed),
        pureOnly: summarise("sim-pure", simRows.filter(pure), resamples, seed),
        byDuration: summariseBy(
          "duration",
          simRows,
          (row) => `${row.durationSec}s`,
          resamples,
          seed,
        ),
        byRhythm: summariseBy("rhythm", simRows, (row) => row.rhythm, resamples, seed),
        byAfRate: summariseBy(
          "afRate",
          simRows.filter((row) => row.afRate !== null),
          (row) => `${row.afRate}`,
          resamples,
          seed,
        ),
        byNoise: summariseBy("noise", simRows, (row) => row.noise, resamples, seed),
        byDurationAndNoise: summariseBy(
          "duration×noise",
          simRows,
          (row) => `${row.durationSec}s×${row.noise}`,
          resamples,
          seed,
        ),
      },
      real:
        inputs.afdb === null
          ? null
          : {
              databaseId: inputs.afdb.database ?? "afdb",
              database: DATABASES[inputs.afdb.database ?? "afdb"].name,
              sha256SumsFile: inputs.afdb.sha256SumsFile,
              records: realByRecord.map((entry) =>
                recordSummary(entry.record, entry.rows),
              ),
              overall: summarise("real", realRows, resamples, seed),
              pureOnly: summarise("real-pure", realRows.filter(pure), resamples, seed),
              byDominantRhythm: summariseBy(
                "rhythm",
                realRows,
                (row) => row.dominant,
                resamples,
                seed,
              ),
            },
      simToReal,
      afDependence,
      realNoise: realNoise?.levels ?? null,
    },
  };
};
