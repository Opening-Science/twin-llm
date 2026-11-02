import { formatNumber, formatTimestamp } from "@/infrastructure/format-measure";
import { type LatticeState } from "@/infrastructure/ui-kit/status-lattice-model";

import { type BenchmarkRead } from "./benchmark-result";
import { type CheckStatus, plural } from "./lab-check";

/**
 * The long jobs the Lab shows (#310): an evaluation run, a rhythm benchmark
 * and a Synthea cohort, all started from the command line, and the checks
 * the page runs as it loads. The page starts none of the command-line jobs;
 * it reads what each one left in its output folder and says how the last
 * run went. A job counts as running while its folder has no final file and
 * was written to within its quiet window; after that it stopped before it
 * finished. Pure: the loader stats the files and hands their times here.
 */

export type JobId = "checks" | "evaluation" | "benchmark" | "synthea";

/** A job's state for the page: a lattice state, or never run on this machine. */
export type JobState = LatticeState | "none";

export type LabJob = Readonly<{
  id: JobId;
  title: string;
  state: JobState;
  /** The lattice line: which run. */
  label: string;
  /** One sentence under it. */
  detail: string;
  /** Frozen time of a finished or stopped run, when the files give one. */
  elapsedMs: number | null;
  /** Epoch ms a running job started, so the browser can keep counting. */
  startedAtMs: number | null;
}>;

/** What a command-line job left on disk, as file times in epoch ms. */
export type JobFiles = Readonly<{
  /** When the run's folder was made, when the file system says. */
  startedMs: number | null;
  /** The newest write to the run's folder or its growing file. */
  lastWriteMs: number | null;
  /** When the final file (meta.json, manifest.json) was written; null while missing. */
  finishedMs: number | null;
}>;

/** No write for this long and no final file: the run stopped. */
export const QUIET_MS: Readonly<Record<"evaluation" | "synthea", number>> = {
  // One model call may take the default 300 s timeout, several in a row.
  evaluation: 15 * 60_000,
  // Java starts and loads its modules before the first patient file.
  synthea: 10 * 60_000,
};

/** Running, finished or stopped, from the final file and the last write. */
export const fileJobState = (
  files: JobFiles,
  nowMs: number,
  quietMs: number,
): LatticeState => {
  if (files.finishedMs !== null) return "done";
  const last = files.lastWriteMs ?? files.startedMs;
  return last !== null && nowMs - last <= quietMs ? "working" : "error";
};

/** From start to end, or null when either is unknown or they are out of order. */
export const spanMs = (startMs: number | null, endMs: number | null): number | null =>
  startMs === null || endMs === null || endMs < startMs ? null : endMs - startMs;

/** A running job's time so far; never below zero when clocks disagree. */
export const liveElapsedMs = (startedAtMs: number, nowMs: number): number =>
  Math.max(0, nowMs - startedAtMs);

const at = (ms: number | null): string =>
  ms === null ? "" : ` ${formatTimestamp(new Date(ms))}`;

/** The times every command-line job shares, by state. */
const fileTimes = (
  state: LatticeState,
  files: JobFiles,
): Pick<LabJob, "elapsedMs" | "startedAtMs"> => ({
  elapsedMs:
    state === "done"
      ? spanMs(files.startedMs, files.finishedMs)
      : state === "error"
        ? spanMs(files.startedMs, files.lastWriteMs)
        : null,
  startedAtMs: state === "working" ? files.startedMs : null,
});

const none = (id: JobId, title: string, detail: string): LabJob => ({
  id,
  title,
  state: "none",
  label: title,
  detail,
  elapsedMs: null,
  startedAtMs: null,
});

export type EvalRunFiles = JobFiles &
  Readonly<{
    id: string;
    /** From meta.json, when it is there and readable. */
    lines: number | null;
    errors: number | null;
  }>;

/** The newest evaluation run folder. */
export const evaluationJob = (run: EvalRunFiles | null, nowMs: number): LabJob => {
  const title = "Evaluation run";
  if (run === null)
    return none("evaluation", title, "No evaluation run on this machine yet.");
  const state = fileJobState(run, nowMs, QUIET_MS.evaluation);
  const detail =
    state === "working"
      ? `Running: answers are going to results.jsonl, last written${at(run.lastWriteMs)}. The page looks again every few seconds.`
      : state === "error"
        ? `Stopped before it wrote meta.json; last written${at(run.lastWriteMs)}. Its lines so far stay in results.jsonl.`
        : [
            `Finished${at(run.finishedMs)}`,
            ...(run.lines === null ? [] : [plural(run.lines, "line")]),
            ...(run.errors === null ? [] : [plural(run.errors, "error")]),
          ].join(" · ") + ".";
  return {
    id: "evaluation",
    title,
    state,
    label: run.id,
    detail,
    ...fileTimes(state, run),
  };
};

/**
 * The newest rhythm benchmark. It writes every file at the end, so there is
 * nothing to see while it runs and no start time to measure from.
 */
export const benchmarkJob = (
  read: BenchmarkRead,
  path: string | null,
  writtenMs: number | null,
): LabJob => {
  const title = "Rhythm benchmark";
  if (read.kind === "missing" || path === null)
    return none("benchmark", title, "No rhythm benchmark result on this machine yet.");
  const base = { id: "benchmark", title, elapsedMs: null, startedAtMs: null } as const;
  if (read.kind === "unreadable")
    return {
      ...base,
      state: "error",
      label: path,
      detail: "The newest result.json is not in the shape this page reads.",
    };
  const finished = read.result.generatedAt ?? null;
  return {
    ...base,
    state: "done",
    label: `Run ${read.result.runId}`,
    detail: `Finished${finished === null ? at(writtenMs) : ` ${formatTimestamp(new Date(finished))}`}. It writes its files only at the end, so a run in progress does not show here.`,
  };
};

export type SyntheaFiles = JobFiles &
  Readonly<{
    /** The cohort folder relative to the repository. */
    dir: string;
    /** Patient files in its fhir folder so far. */
    patientFiles: number;
    /** From manifest.json, when it is there and readable. */
    cohortId: string | null;
    population: number | null;
  }>;

/** The newest Synthea cohort that `bun run synthea:generate` wrote. */
export const syntheaJob = (run: SyntheaFiles | null, nowMs: number): LabJob => {
  const title = "Synthea cohort";
  if (run === null)
    return none("synthea", title, "No Synthea cohort generated on this machine yet.");
  const state = fileJobState(run, nowMs, QUIET_MS.synthea);
  const files = plural(run.patientFiles, "patient file");
  const detail =
    state === "working"
      ? `Running: ${files} so far, last written${at(run.lastWriteMs)}. The page looks again every few seconds.`
      : state === "error"
        ? `Stopped before it wrote manifest.json, with ${files}; last written${at(run.lastWriteMs)}.`
        : [
            `Finished${at(run.finishedMs)}`,
            ...(run.population === null
              ? []
              : [`population ${formatNumber(run.population, 0)}`]),
            files,
          ].join(" · ") + ".";
  return {
    id: "synthea",
    title,
    state,
    label: run.cohortId ?? run.dir,
    detail,
    ...fileTimes(state, run),
  };
};

/** The checks this page ran as it loaded, with the time they took. */
export const checksJob = (
  statuses: readonly CheckStatus[],
  elapsedMs: number,
): LabJob => {
  const count = (status: CheckStatus) =>
    statuses.filter((each) => each === status).length;
  return {
    id: "checks",
    title: "Checks",
    state: "done",
    label: `${plural(statuses.length, "check")} on this load`,
    detail: `${formatNumber(count("ok"), 0)} OK, ${formatNumber(count("not-ok"), 0)} Not OK, ${formatNumber(count("unknown"), 0)} Unknown.`,
    elapsedMs: Math.max(0, elapsedMs),
    startedAtMs: null,
  };
};

/** Whether the page should look again: some job is still running. */
export const anyRunning = (jobs: readonly LabJob[]): boolean =>
  jobs.some((job) => job.state === "working");

/** The newest of several runs by start time, then by last write. */
export const newestFiles = <T extends JobFiles>(runs: readonly T[]): T | null =>
  [...runs].sort(
    (a, b) =>
      (b.startedMs ?? b.lastWriteMs ?? 0) - (a.startedMs ?? a.lastWriteMs ?? 0) ||
      (b.lastWriteMs ?? 0) - (a.lastWriteMs ?? 0),
  )[0] ?? null;
