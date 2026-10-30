import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { EVAL_RUNS_DIR, RHYTHM_BENCH_DIR } from "@/infrastructure/local-artefacts";

import { type BenchmarkRead, newestRun, parseBenchmark } from "./benchmark-result";
import { type EvalRun, sortRuns, summariseRun } from "./eval-runs";

/**
 * The I/O half of the Results section: lists `evaluation/runs/` and reads
 * each run's meta.json and report.md, and reads the newest rhythm benchmark
 * result.json. Only files inside the repository are read, each at most
 * `MAX_FILE_BYTES`; results.jsonl, the review sheet and its key are never
 * opened.
 */

const MAX_FILE_BYTES = 2_000_000;
const MAX_RUNS = 100;
const RUN_ID = /^[\w.:+-]{1,128}$/;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

/** A file's text, or null when it is missing, not a file or too large. */
const readSmall = async (path: string): Promise<string | null> => {
  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile()) return null;
  if (found.size > MAX_FILE_BYTES) {
    console.error("[lab] result file over the size cap", found.size);
    return null;
  }
  return readFile(path, "utf8").catch(() => null);
};

export type BenchmarkData = Readonly<{
  /** The folder the benchmark writes to, relative to the repository. */
  dir: string;
  /** Run folders found in it. */
  runs: number;
  /** The newest run's result.json, relative to the repository, or null. */
  path: string | null;
  read: BenchmarkRead;
}>;

export type ResultsData = Readonly<{
  runsDir: string;
  runs: readonly EvalRun[];
  /** More run folders than the page lists. */
  more: boolean;
  /** The runs folder could not be listed for a reason other than not existing. */
  failed: boolean;
  benchmark: BenchmarkData;
}>;

const loadRuns = async (
  root: string,
): Promise<Pick<ResultsData, "runs" | "more" | "failed">> => {
  const dir = join(root, EVAL_RUNS_DIR);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const ids = entries
      .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    const runs = await Promise.all(
      ids.slice(0, MAX_RUNS).map(async (id) => {
        const [meta, report] = await Promise.all([
          readSmall(join(dir, id, "meta.json")),
          readSmall(join(dir, id, "report.md")),
        ]);
        return summariseRun(id, meta, report);
      }),
    );
    return { runs: sortRuns(runs), more: ids.length > MAX_RUNS, failed: false };
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing)
      console.error("[lab] evaluation runs could not be listed", errorName(error));
    return { runs: [], more: false, failed: !missing };
  }
};

/** Every `<RHYTHM_BENCH_DIR>/<run>/result.json`; the page shows the newest. */
const loadBenchmark = async (root: string): Promise<BenchmarkData> => {
  const dir = join(root, RHYTHM_BENCH_DIR);
  const names = await readdir(dir, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
        .map((entry) => entry.name),
    )
    .catch(() => []);
  const runs = await Promise.all(
    names.slice(0, MAX_RUNS).map(async (name) => ({
      dir: name,
      read: parseBenchmark(await readSmall(join(dir, name, "result.json"))),
    })),
  );
  const newest = newestRun(runs.filter((run) => run.read.kind !== "missing"));
  return {
    dir: RHYTHM_BENCH_DIR,
    runs: runs.filter((run) => run.read.kind !== "missing").length,
    path: newest === null ? null : `${RHYTHM_BENCH_DIR}/${newest.dir}/result.json`,
    read: newest?.read ?? { kind: "missing" },
  };
};

export const loadResults = async (): Promise<ResultsData> => {
  const root = process.cwd();
  const [runs, benchmark] = await Promise.all([loadRuns(root), loadBenchmark(root)]);
  return { runsDir: EVAL_RUNS_DIR, ...runs, benchmark };
};
