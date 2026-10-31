/**
 * The one tick loop that starts scheduled task runs (#54), with its clock,
 * store and runner passed in so tests drive it without timers.
 *
 * Single flight: a task already running in this process is never started
 * again, and a run starts only after `claim` moved the task's next run
 * forward in the database, so a second tick (or a second process) that read
 * the same due row cannot start it twice. Concurrency is bounded: at most
 * `concurrency()` runs at a time, 1 when the model runs on this machine. A
 * due task that finds no free slot waits for a later tick; its next run has
 * not moved, so it is not lost. Ticks never overlap.
 */

export type DueTask = Readonly<{ id: string }>;

export type TaskSchedulerDeps<T extends DueTask> = Readonly<{
  now: () => Date;
  /** Enabled tasks whose next run is at or before `now`, oldest first. */
  listDue: (now: Date) => Promise<readonly T[]>;
  /** Moves the task's next run on and marks it running; false when another tick won. */
  claim: (task: T, now: Date) => Promise<boolean>;
  /** One run, start to finish; it records its own outcome. */
  run: (task: T, now: Date) => Promise<void>;
  concurrency: () => number;
  logError: (message: string, error: unknown) => void;
}>;

export type TaskScheduler = Readonly<{
  /** One pass over the due tasks; resolves once the runs it started are claimed. */
  tick: () => Promise<void>;
  /** Ids of the runs in flight. */
  running: () => ReadonlySet<string>;
  /** Resolves when no run is in flight; for tests and shutdown. */
  idle: () => Promise<void>;
}>;

export const createTaskScheduler = <T extends DueTask>(
  deps: TaskSchedulerDeps<T>,
): TaskScheduler => {
  const inFlight = new Map<string, Promise<void>>();
  const state = { ticking: false };

  const start = (task: T, now: Date): void => {
    const done = deps
      .run(task, now)
      .catch((error: unknown) => deps.logError("task run failed", error))
      .finally(() => {
        inFlight.delete(task.id);
      });
    inFlight.set(task.id, done);
  };

  const pass = async (): Promise<void> => {
    const now = deps.now();
    const due = await deps.listDue(now);
    for (const task of due) {
      if (inFlight.size >= Math.max(1, deps.concurrency())) return;
      if (inFlight.has(task.id)) continue;
      // Held in the map while claiming, so a run never starts twice in this process.
      inFlight.set(task.id, Promise.resolve());
      const claimed = await deps.claim(task, now).catch((error: unknown) => {
        deps.logError("task claim failed", error);
        return false;
      });
      if (claimed) start(task, now);
      else inFlight.delete(task.id);
    }
  };

  return {
    tick: async () => {
      if (state.ticking) return;
      state.ticking = true;
      try {
        await pass();
      } catch (error) {
        deps.logError("task tick failed", error);
      } finally {
        state.ticking = false;
      }
    },
    running: () => new Set(inFlight.keys()),
    idle: async () => {
      await Promise.all([...inFlight.values()]);
    },
  };
};
