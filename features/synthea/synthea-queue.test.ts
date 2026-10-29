import { describe, expect, test } from "bun:test";

import { type SyntheaOptions } from "./synthea-options";
import {
  createJobQueue,
  type QueueDeps,
  type RunInput,
  type RunOutcome,
} from "./synthea-queue";

const OPTIONS: SyntheaOptions = {
  people: 3,
  seed: 11,
  ageMin: 20,
  ageMax: 30,
  sex: "any",
  state: "Utah",
  modules: [],
  formats: ["fhir"],
};

type PendingRun = Readonly<{
  input: RunInput;
  signal: AbortSignal;
  progress: (done: number) => void;
  finish: (outcome: RunOutcome) => void;
  crash: (error: Error) => void;
}>;

type Timer = { fn: () => void; ms: number; cancelled: boolean };

/** A queue whose runs, folders and timers are all in the test's hands. */
const harness = (overrides: Partial<QueueDeps> = {}) => {
  const runs: PendingRun[] = [];
  const timers: Timer[] = [];
  const removed: string[] = [];
  const errors: string[] = [];
  const clock = { at: 1_000 };
  const ids = { next: 0, dir: 0 };
  const queue = createJobQueue({
    run: (input, signal, progress) =>
      new Promise<RunOutcome>((finish, crash) => {
        runs.push({ input, signal, progress, finish, crash });
      }),
    makeDir: () => Promise.resolve(`/tmp/job-${(ids.dir += 1) - 1}`),
    removeDir: (dir) => {
      removed.push(dir);
      return Promise.resolve();
    },
    readZip: (dir) => Promise.resolve(new TextEncoder().encode(`zip of ${dir}`)),
    logError: (message) => errors.push(message),
    now: () => clock.at,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    newId: () => `job-${(ids.next += 1)}`,
    random: () => 0.5,
    timeoutMs: 60_000,
    resultTtlMs: 600_000,
    maxQueued: 2,
    ...overrides,
  });
  return { queue, runs, timers, removed, errors, clock };
};

/** Lets pending promise callbacks run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

const OK: RunOutcome = { ok: true, patientFiles: 4, preview: null };

describe("createJobQueue", () => {
  test("runs one job at a time, in order, and reports place in line", async () => {
    const { queue, runs } = harness();
    const first = queue.submit(OPTIONS);
    const second = queue.submit({ ...OPTIONS, seed: null });
    expect(first.ok && first.job.state).toBe("running");
    expect(second.ok && second.job).toEqual({
      id: "job-2",
      state: "queued",
      position: 1,
      people: 3,
      done: 0,
      seed: 1_073_741_823,
      patientFiles: null,
      preview: null,
    });
    await settle();
    expect(runs.map((run) => run.input.id)).toEqual(["job-1"]);
    runs[0]?.progress(2);
    expect(queue.status("job-1")?.done).toBe(2);
    runs[0]?.finish(OK);
    await settle();
    expect(queue.status("job-1")?.state).toBe("done");
    expect(queue.status("job-1")?.patientFiles).toBe(4);
    expect(queue.status("job-2")?.state).toBe("running");
    expect(runs.map((run) => run.input.id)).toEqual(["job-1", "job-2"]);
  });

  test("refuses new jobs when the line is full", () => {
    const { queue } = harness();
    queue.submit(OPTIONS);
    queue.submit(OPTIONS);
    queue.submit(OPTIONS);
    expect(queue.submit(OPTIONS)).toEqual({ ok: false, reason: "busy" });
  });

  test("downloads once and removes the folder", async () => {
    const { queue, runs, removed } = harness();
    queue.submit(OPTIONS);
    await settle();
    runs[0]?.finish(OK);
    await settle();
    const bytes = await queue.download("job-1");
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe("zip of /tmp/job-0");
    expect(removed).toEqual(["/tmp/job-0"]);
    expect(queue.status("job-1")?.state).toBe("downloaded");
    expect(await queue.download("job-1")).toBe(null);
    expect(await queue.download("nope")).toBe(null);
  });

  test("stops a run that passes the time limit and removes its folder", async () => {
    const { queue, runs, timers, removed } = harness();
    queue.submit(OPTIONS);
    await settle();
    const limit = timers.find((timer) => timer.ms === 60_000);
    limit?.fn();
    expect(runs[0]?.signal.aborted).toBe(true);
    runs[0]?.finish({ ok: false });
    await settle();
    expect(queue.status("job-1")?.state).toBe("timed-out");
    expect(removed).toEqual(["/tmp/job-0"]);
    expect(await queue.download("job-1")).toBe(null);
  });

  test("deletes a result nobody downloads", async () => {
    const { queue, runs, timers, removed } = harness();
    queue.submit(OPTIONS);
    await settle();
    runs[0]?.finish(OK);
    await settle();
    expect(timers.find((timer) => timer.ms === 60_000)?.cancelled).toBe(true);
    timers.find((timer) => timer.ms === 600_000)?.fn();
    await settle();
    expect(queue.status("job-1")?.state).toBe("expired");
    expect(removed).toEqual(["/tmp/job-0"]);
  });

  test("a failed or crashed run removes its folder and the next job starts", async () => {
    const { queue, runs, removed, errors } = harness();
    queue.submit(OPTIONS);
    queue.submit(OPTIONS);
    await settle();
    runs[0]?.crash(new Error("java not found"));
    await settle();
    expect(queue.status("job-1")?.state).toBe("failed");
    expect(errors).toEqual(["[synthea] run failed"]);
    runs[1]?.finish({ ok: false });
    await settle();
    expect(queue.status("job-2")?.state).toBe("failed");
    expect(removed).toEqual(["/tmp/job-0", "/tmp/job-1"]);
  });

  test("forgets ended jobs after the result time", async () => {
    const { queue, runs, clock } = harness();
    queue.submit(OPTIONS);
    await settle();
    runs[0]?.finish({ ok: false });
    await settle();
    clock.at += 600_000;
    expect(queue.status("job-1")).toBe(null);
  });
});
