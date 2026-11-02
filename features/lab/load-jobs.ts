import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { EVAL_RUNS_DIR } from "@/infrastructure/local-artefacts";

import { parseRunMeta } from "./eval-runs";
import {
  benchmarkJob,
  checksJob,
  type EvalRunFiles,
  evaluationJob,
  type LabJob,
  newestFiles,
  type SyntheaFiles,
  syntheaJob,
} from "./lab-jobs";
import { type LabSection } from "./lab-check";
import { type BenchmarkData } from "./load-results";
import { loadVerifiability } from "./run-lab-checks";

/**
 * The I/O half of the Lab's job lines (#310): file times only. For an
 * evaluation run it stats the run folder, results.jsonl and meta.json and
 * reads meta.json of the newest run (results.jsonl is never opened). For
 * Synthea it stats each cohort folder's synthea.properties (written as a run
 * starts), fhir folder and manifest.json, counts the patient files of the
 * newest and reads its manifest. Nothing here starts or stops a job.
 */

const SYNTHEA_DIR = ".synthea";
const NOT_COHORTS: ReadonlySet<string> = new Set(["cache", "downloads"]);
const RUN_ID = /^[\w.:+-]{1,128}$/;
const MAX_RUNS = 100;
const MAX_META_BYTES = 2_000_000;

type Times = Readonly<{ birthMs: number | null; mtimeMs: number }>;

const timesOf = async (path: string): Promise<Times | null> => {
  const found = await stat(path).catch(() => null);
  if (found === null) return null;
  // Some file systems give no birth time; 0 then.
  return {
    birthMs: found.birthtimeMs > 0 ? found.birthtimeMs : null,
    mtimeMs: found.mtimeMs,
  };
};

const newest = (...values: readonly (number | null | undefined)[]): number | null => {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length === 0 ? null : Math.max(...known);
};

const childDirs = async (dir: string): Promise<string[]> =>
  readdir(dir, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
        .map((entry) => entry.name),
    )
    .catch(() => []);

const readMeta = async (path: string) => {
  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile() || found.size > MAX_META_BYTES) return null;
  const text = await readFile(path, "utf8").catch(() => null);
  return text === null ? null : parseRunMeta(text);
};

const newestEvalRun = async (root: string): Promise<EvalRunFiles | null> => {
  const dir = join(root, EVAL_RUNS_DIR);
  const ids = (await childDirs(dir)).sort().reverse().slice(0, MAX_RUNS);
  const runs = await Promise.all(
    ids.map(async (id) => {
      const [folder, results, meta] = await Promise.all([
        timesOf(join(dir, id)),
        timesOf(join(dir, id, "results.jsonl")),
        timesOf(join(dir, id, "meta.json")),
      ]);
      return {
        id,
        startedMs: folder?.birthMs ?? null,
        lastWriteMs: newest(folder?.mtimeMs, results?.mtimeMs, meta?.mtimeMs),
        finishedMs: meta?.mtimeMs ?? null,
        lines: null,
        errors: null,
      };
    }),
  );
  const run = newestFiles(runs);
  if (run === null || run.finishedMs === null) return run;
  const meta = await readMeta(join(dir, run.id, "meta.json"));
  return {
    ...run,
    lines: meta?.counts?.lines ?? null,
    errors: meta?.counts?.errors ?? null,
  };
};

type CohortFolder = Readonly<{ rel: string; path: string }>;

const syntheaFolders = async (root: string): Promise<CohortFolder[]> => {
  const base = join(root, SYNTHEA_DIR);
  const names = (await childDirs(base)).filter((name) => !NOT_COHORTS.has(name));
  return [
    { rel: SYNTHEA_DIR, path: base },
    ...names.map((name) => ({ rel: `${SYNTHEA_DIR}/${name}`, path: join(base, name) })),
  ];
};

const readManifest = async (
  path: string,
): Promise<Readonly<{ cohortId: string | null; population: number | null }>> => {
  const text = await readFile(path, "utf8").catch(() => null);
  try {
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    const cohortId = Reflect.get(parsed, "cohortId");
    const population = Reflect.get(parsed, "population");
    return {
      cohortId: typeof cohortId === "string" ? cohortId : null,
      population: typeof population === "number" ? population : null,
    };
  } catch {
    return { cohortId: null, population: null };
  }
};

const newestSynthea = async (root: string): Promise<SyntheaFiles | null> => {
  const folders = await syntheaFolders(root);
  const found = await Promise.all(
    folders.map(async (folder) => {
      const [props, own, fhir, manifest] = await Promise.all([
        timesOf(join(folder.path, "synthea.properties")),
        timesOf(folder.path),
        timesOf(join(folder.path, "fhir")),
        timesOf(join(folder.path, "manifest.json")),
      ]);
      // A folder the script has not run in is not a cohort.
      if (props === null) return null;
      return {
        folder,
        startedMs: props.mtimeMs,
        lastWriteMs: newest(own?.mtimeMs, fhir?.mtimeMs, manifest?.mtimeMs),
        // A manifest older than the properties is the run before; the script removes it first.
        finishedMs:
          manifest !== null && manifest.mtimeMs >= props.mtimeMs
            ? manifest.mtimeMs
            : null,
      };
    }),
  );
  const run = newestFiles(found.filter((each) => each !== null));
  if (run === null) return null;
  const patientFiles = await readdir(join(run.folder.path, "fhir"))
    .then((names) => names.filter((name) => name.endsWith(".json")).length)
    .catch(() => 0);
  const manifest =
    run.finishedMs === null
      ? { cohortId: null, population: null }
      : await readManifest(join(run.folder.path, "manifest.json"));
  return {
    dir: run.folder.rel,
    startedMs: run.startedMs,
    lastWriteMs: run.lastWriteMs,
    finishedMs: run.finishedMs,
    patientFiles,
    ...manifest,
  };
};

/** The command-line jobs' lines, newest run of each. */
export const loadJobs = async (benchmark: BenchmarkData): Promise<readonly LabJob[]> => {
  const root = process.cwd();
  const [evaluation, synthea, written] = await Promise.all([
    newestEvalRun(root),
    newestSynthea(root),
    benchmark.path === null ? null : timesOf(join(root, benchmark.path)),
  ]);
  const now = Date.now();
  return [
    evaluationJob(evaluation, now),
    benchmarkJob(benchmark.read, benchmark.path, written?.mtimeMs ?? null),
    syntheaJob(synthea, now),
  ];
};

/** The Verifiability checks and how long this load took to run them. */
export const loadTimedChecks = async (): Promise<
  Readonly<{ section: LabSection; job: LabJob }>
> => {
  const started = performance.now();
  const section = await loadVerifiability();
  return {
    section,
    job: checksJob(
      section.checks.map((check) => check.status),
      performance.now() - started,
    ),
  };
};
