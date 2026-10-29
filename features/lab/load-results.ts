import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { labEnv } from "@/infrastructure/env";
import {
  EVAL_RUNS_DIR,
  RHYTHM_BENCH_DEFAULT_PATH,
} from "@/infrastructure/local-artefacts";

import { type BenchmarkRead, parseBenchmark } from "./benchmark-result";
import { type EvalRun, sortRuns, summariseRun } from "./eval-runs";
import { insideRepo } from "./repo-path";

/**
 * The I/O half of the Results section: lists `evaluation/runs/` and reads
 * each run's meta.json and report.md, and reads the rhythm benchmark's
 * result file. Only files inside the repository are read, each at most
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
  /** The file relative to the repository, or the variable when it points outside. */
  path: string;
  read: BenchmarkRead | Readonly<{ kind: "outside" }>;
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

const loadBenchmark = async (root: string): Promise<BenchmarkData> => {
  const path = labEnv().rhythmBenchResult ?? RHYTHM_BENCH_DEFAULT_PATH;
  const absolute = insideRepo(root, path);
  // Shown relative to the repository, so no home path reaches the page.
  if (absolute === null)
    return { path: "$RHYTHM_BENCH_RESULT", read: { kind: "outside" } };
  return {
    path: relative(root, absolute),
    read: parseBenchmark(await readSmall(absolute)),
  };
};

export const loadResults = async (): Promise<ResultsData> => {
  const root = process.cwd();
  const [runs, benchmark] = await Promise.all([loadRuns(root), loadBenchmark(root)]);
  return { runsDir: EVAL_RUNS_DIR, ...runs, benchmark };
};
