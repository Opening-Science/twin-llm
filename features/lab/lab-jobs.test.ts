import { describe, expect, test } from "bun:test";

import {
  anyRunning,
  benchmarkJob,
  checksJob,
  type EvalRunFiles,
  evaluationJob,
  fileJobState,
  liveElapsedMs,
  newestFiles,
  QUIET_MS,
  spanMs,
  type SyntheaFiles,
  syntheaJob,
} from "./lab-jobs";
import { type BenchmarkResult } from "./benchmark-result";

const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);
const MIN = 60_000;

describe("fileJobState", () => {
  test("a final file means done, whatever the times", () => {
    expect(
      fileJobState(
        { startedMs: T0, lastWriteMs: T0, finishedMs: T0 },
        T0 + 99 * MIN,
        MIN,
      ),
    ).toBe("done");
  });

  test("no final file: running inside the quiet window, stopped after it", () => {
    const files = { startedMs: T0, lastWriteMs: T0 + MIN, finishedMs: null };
    expect(fileJobState(files, T0 + 2 * MIN, MIN)).toBe("working");
    expect(fileJobState(files, T0 + 3 * MIN, MIN)).toBe("error");
  });

  test("falls back to the start time, and with no time at all it stopped", () => {
    expect(
      fileJobState({ startedMs: T0, lastWriteMs: null, finishedMs: null }, T0, MIN),
    ).toBe("working");
    expect(
      fileJobState({ startedMs: null, lastWriteMs: null, finishedMs: null }, T0, MIN),
    ).toBe("error");
  });
});

describe("times", () => {
  test("spanMs needs both ends in order", () => {
    expect(spanMs(T0, T0 + 5_000)).toBe(5_000);
    expect(spanMs(null, T0)).toBeNull();
    expect(spanMs(T0, null)).toBeNull();
    expect(spanMs(T0 + 1, T0)).toBeNull();
  });

  test("liveElapsedMs never goes below zero", () => {
    expect(liveElapsedMs(T0, T0 + 83_400)).toBe(83_400);
    expect(liveElapsedMs(T0 + 10, T0)).toBe(0);
  });

  test("newestFiles picks the latest start, then the latest write", () => {
    const a = { id: "a", startedMs: T0, lastWriteMs: T0 + 9, finishedMs: null };
    const b = { id: "b", startedMs: T0 + 1, lastWriteMs: T0 + 1, finishedMs: null };
    const c = { id: "c", startedMs: T0 + 1, lastWriteMs: T0 + 5, finishedMs: null };
    expect(newestFiles([a, b, c])?.id).toBe("c");
    expect(newestFiles([])).toBeNull();
  });
});

const evalRun = (over: Partial<EvalRunFiles>): EvalRunFiles => ({
  id: "2026-11-02-ollama-abc",
  startedMs: T0,
  lastWriteMs: T0 + MIN,
  finishedMs: null,
  lines: null,
  errors: null,
  ...over,
});

describe("evaluationJob", () => {
  test("no run: not run yet", () => {
    const job = evaluationJob(null, T0);
    expect(job.state).toBe("none");
    expect(job.detail).toBe("No evaluation run on this machine yet.");
  });

  test("running: counts on from the folder's start, no frozen time", () => {
    const job = evaluationJob(evalRun({}), T0 + 2 * MIN);
    expect(job.state).toBe("working");
    expect(job.startedAtMs).toBe(T0);
    expect(job.elapsedMs).toBeNull();
    expect(job.label).toBe("2026-11-02-ollama-abc");
    expect(job.detail).toStartWith("Running: answers are going to results.jsonl");
  });

  test("quiet too long without meta.json: stopped, timed to its last write", () => {
    const job = evaluationJob(evalRun({}), T0 + MIN + QUIET_MS.evaluation + 1);
    expect(job.state).toBe("error");
    expect(job.elapsedMs).toBe(MIN);
    expect(job.startedAtMs).toBeNull();
    expect(job.detail).toStartWith("Stopped before it wrote meta.json");
  });

  test("finished: the span to meta.json and its counts", () => {
    const job = evaluationJob(
      evalRun({ finishedMs: T0 + 90_000, lines: 12, errors: 1 }),
      T0 + 99 * MIN,
    );
    expect(job.state).toBe("done");
    expect(job.elapsedMs).toBe(90_000);
    expect(job.detail).toBe("Finished 2 Nov 2026, 09:01 UTC · 12 lines · 1 error.");
  });
});

const benchResult = {
  runId: "quick",
  generatedAt: "2026-11-01T08:30:00.000Z",
} as unknown as BenchmarkResult;

describe("benchmarkJob", () => {
  test("missing, unreadable and found", () => {
    expect(benchmarkJob({ kind: "missing" }, null, null).state).toBe("none");
    const bad = benchmarkJob({ kind: "unreadable" }, ".rhythm-bench/x/result.json", T0);
    expect(bad.state).toBe("error");
    expect(bad.label).toBe(".rhythm-bench/x/result.json");
    const good = benchmarkJob(
      { kind: "found", result: benchResult },
      ".rhythm-bench/quick/result.json",
      T0,
    );
    expect(good.state).toBe("done");
    expect(good.label).toBe("Run quick");
    expect(good.elapsedMs).toBeNull();
    expect(good.detail).toStartWith("Finished 1 Nov 2026, 08:30 UTC.");
  });
});

const synthea = (over: Partial<SyntheaFiles>): SyntheaFiles => ({
  dir: ".synthea/synthea-v4-seed7",
  startedMs: T0,
  lastWriteMs: T0 + MIN,
  finishedMs: null,
  patientFiles: 3,
  cohortId: null,
  population: null,
  ...over,
});

describe("syntheaJob", () => {
  test("running: patient files so far under the folder name", () => {
    const job = syntheaJob(synthea({}), T0 + 2 * MIN);
    expect(job.state).toBe("working");
    expect(job.label).toBe(".synthea/synthea-v4-seed7");
    expect(job.detail).toStartWith("Running: 3 patient files so far");
  });

  test("stopped and finished", () => {
    expect(syntheaJob(synthea({}), T0 + MIN + QUIET_MS.synthea + 1).state).toBe("error");
    const done = syntheaJob(
      synthea({
        finishedMs: T0 + 2 * MIN,
        patientFiles: 13,
        cohortId: "synthea-v4-seed7",
        population: 12,
      }),
      T0 + 99 * MIN,
    );
    expect(done.state).toBe("done");
    expect(done.label).toBe("synthea-v4-seed7");
    expect(done.elapsedMs).toBe(2 * MIN);
    expect(done.detail).toBe(
      "Finished 2 Nov 2026, 09:02 UTC · population 12 · 13 patient files.",
    );
  });

  test("none", () => {
    expect(syntheaJob(null, T0).state).toBe("none");
  });
});

describe("checksJob and anyRunning", () => {
  test("counts the statuses and keeps the time", () => {
    const job = checksJob(["ok", "ok", "not-ok", "unknown"], 1_234);
    expect(job.state).toBe("done");
    expect(job.label).toBe("4 checks on this load");
    expect(job.detail).toBe("2 OK, 1 Not OK, 1 Unknown.");
    expect(job.elapsedMs).toBe(1_234);
  });

  test("only a working job keeps the page looking", () => {
    expect(anyRunning([checksJob([], 0), evaluationJob(null, T0)])).toBe(false);
    expect(anyRunning([evaluationJob(evalRun({}), T0)])).toBe(true);
  });
});
