import { resolveSeed } from "./synthea-args";
import { type SyntheaOptions } from "./synthea-options";
import { type PatientPreview } from "./synthea-output";

/**
 * One Synthea run at a time, in arrival order.
 *
 * Every job gets its own temporary folder. The folder is removed when the
 * result is downloaded, when nobody downloads it within `resultTtlMs`, when the
 * run fails, or when it passes `timeoutMs` (the run is aborted first). Nothing
 * else keeps a copy. Job records themselves are dropped a while after they end.
 *
 * All effects come in as `deps`, so tests drive the queue with fake runs,
 * folders and timers.
 */

export type JobState =
  "queued" | "running" | "done" | "failed" | "timed-out" | "expired" | "downloaded";

export type RunOutcome =
  | Readonly<{ ok: true; patientFiles: number; preview: PatientPreview | null }>
  | Readonly<{ ok: false }>;

export type RunInput = Readonly<{
  id: string;
  options: SyntheaOptions;
  seed: number;
  dir: string;
}>;

export type QueueDeps = Readonly<{
  run: (
    input: RunInput,
    signal: AbortSignal,
    onProgress: (done: number) => void,
  ) => Promise<RunOutcome>;
  makeDir: () => Promise<string>;
  removeDir: (dir: string) => Promise<void>;
  /** Reads the finished zip from a job folder. */
  readZip: (dir: string) => Promise<Uint8Array>;
  logError: (message: string, error: unknown) => void;
  now: () => number;
  /** Calls `fn` after `ms`; the returned function cancels it. */
  setTimer: (fn: () => void, ms: number) => () => void;
  newId: () => string;
  random: () => number;
  timeoutMs: number;
  resultTtlMs: number;
  /** How many jobs may wait behind the running one. */
  maxQueued: number;
}>;

export type JobView = Readonly<{
  id: string;
  state: JobState;
  /** Place in line while queued, 1 for next; null otherwise. */
  position: number | null;
  people: number;
  /** People finished so far, from Synthea's progress lines. */
  done: number;
  seed: number;
  patientFiles: number | null;
  preview: PatientPreview | null;
}>;

type Job = Readonly<{
  id: string;
  options: SyntheaOptions;
  seed: number;
  state: JobState;
  done: number;
  dir: string | null;
  patientFiles: number | null;
  preview: PatientPreview | null;
  endedAt: number | null;
}>;

export type SubmitResult =
  Readonly<{ ok: true; job: JobView }> | Readonly<{ ok: false; reason: "busy" }>;

export type JobQueue = Readonly<{
  submit: (options: SyntheaOptions) => SubmitResult;
  status: (id: string) => JobView | null;
  /** The zip of a finished job, once; its folder is removed after reading. */
  download: (id: string) => Promise<Uint8Array | null>;
}>;

const ENDED: ReadonlySet<JobState> = new Set([
  "failed",
  "timed-out",
  "expired",
  "downloaded",
]);

export const createJobQueue = (deps: QueueDeps): JobQueue => {
  const jobs = new Map<string, Job>();
  const running = { id: null as string | null };

  const update = (id: string, change: Partial<Job>): Job | null => {
    const current = jobs.get(id);
    if (current === undefined) return null;
    const next = { ...current, ...change };
    jobs.set(id, next);
    return next;
  };

  const waiting = (): readonly Job[] =>
    [...jobs.values()].filter((job) => job.state === "queued");

  const prune = (): void => {
    const at = deps.now();
    [...jobs.values()]
      .filter((job) => job.endedAt !== null && at - job.endedAt >= deps.resultTtlMs)
      .filter((job) => ENDED.has(job.state))
      .forEach((job) => jobs.delete(job.id));
  };

  const removeQuietly = async (dir: string | null): Promise<void> => {
    if (dir === null) return;
    try {
      await deps.removeDir(dir);
    } catch (error) {
      deps.logError("[synthea] could not remove a job folder", error);
    }
  };

  const end = async (id: string, state: JobState): Promise<void> => {
    const job = update(id, { state, endedAt: deps.now() });
    await removeQuietly(job?.dir ?? null);
    update(id, { dir: null });
  };

  const execute = async (job: Job): Promise<void> => {
    const controller = new AbortController();
    const cancelTimer = deps.setTimer(() => controller.abort(), deps.timeoutMs);
    try {
      const dir = await deps.makeDir();
      update(job.id, { dir });
      const outcome = await deps.run(
        { id: job.id, options: job.options, seed: job.seed, dir },
        controller.signal,
        (done) => {
          if (jobs.get(job.id)?.state === "running") update(job.id, { done });
        },
      );
      if (controller.signal.aborted) return await end(job.id, "timed-out");
      if (!outcome.ok) return await end(job.id, "failed");
      update(job.id, {
        state: "done",
        done: job.options.people,
        patientFiles: outcome.patientFiles,
        preview: outcome.preview,
        endedAt: deps.now(),
      });
      deps.setTimer(() => {
        if (jobs.get(job.id)?.state === "done") void end(job.id, "expired");
      }, deps.resultTtlMs);
    } catch (error) {
      deps.logError("[synthea] run failed", error);
      await end(job.id, controller.signal.aborted ? "timed-out" : "failed");
    } finally {
      cancelTimer();
    }
  };

  const pump = (): void => {
    if (running.id !== null) return;
    const next = waiting()[0];
    if (next === undefined) return;
    running.id = next.id;
    const started = update(next.id, { state: "running" }) ?? next;
    void execute(started).finally(() => {
      running.id = null;
      pump();
    });
  };

  const view = (job: Job): JobView => {
    const line = waiting();
    const place = line.findIndex((other) => other.id === job.id);
    return {
      id: job.id,
      state: job.state,
      position: place === -1 ? null : place + 1,
      people: job.options.people,
      done: job.done,
      seed: job.seed,
      patientFiles: job.patientFiles,
      preview: job.preview,
    };
  };

  const submit = (options: SyntheaOptions): SubmitResult => {
    prune();
    if (waiting().length >= deps.maxQueued) return { ok: false, reason: "busy" };
    const job: Job = {
      id: deps.newId(),
      options,
      seed: resolveSeed(options.seed, deps.random),
      state: "queued",
      done: 0,
      dir: null,
      patientFiles: null,
      preview: null,
      endedAt: null,
    };
    jobs.set(job.id, job);
    pump();
    return { ok: true, job: view(jobs.get(job.id) ?? job) };
  };

  const status = (id: string): JobView | null => {
    prune();
    const job = jobs.get(id);
    return job === undefined ? null : view(job);
  };

  const download = async (id: string): Promise<Uint8Array | null> => {
    const job = jobs.get(id);
    if (job === undefined || job.state !== "done" || job.dir === null) return null;
    // Marked before reading, so a second request cannot read the same folder.
    update(id, { state: "downloaded", endedAt: deps.now() });
    try {
      return await deps.readZip(job.dir);
    } catch (error) {
      deps.logError("[synthea] could not read a finished zip", error);
      return null;
    } finally {
      await removeQuietly(job.dir);
      update(id, { dir: null });
    }
  };

  return { submit, status, download };
};
