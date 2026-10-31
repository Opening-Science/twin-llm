import { describe, expect, test } from "bun:test";

import { createTaskScheduler, type TaskSchedulerDeps } from "./task-scheduler";

type Task = Readonly<{ id: string }>;

const gate = () => {
  const box: { open: () => void } = { open: () => undefined };
  const promise = new Promise<void>((resolve) => {
    box.open = resolve;
  });
  return { promise, open: () => box.open() };
};

const harness = (due: readonly Task[], concurrency = 1) => {
  const claimed = new Set<string>();
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof gate>>();
  const errors: string[] = [];
  const deps: TaskSchedulerDeps<Task> = {
    now: () => new Date("2026-01-15T07:00:00Z"),
    listDue: async () => due.filter((task) => !claimed.has(task.id)),
    claim: async (task) => {
      if (claimed.has(task.id)) return false;
      claimed.add(task.id);
      return true;
    },
    run: async (task) => {
      started.push(task.id);
      const held = gate();
      gates.set(task.id, held);
      await held.promise;
    },
    concurrency: () => concurrency,
    logError: (message) => errors.push(message),
  };
  return { deps, started, gates, errors, claimed };
};

describe("createTaskScheduler", () => {
  test("a task still running is not started again by later ticks", async () => {
    const h = harness([{ id: "a" }]);
    // A store that lists it again, as if the claim had not moved it on.
    const scheduler = createTaskScheduler({
      ...h.deps,
      listDue: async () => [{ id: "a" }],
      claim: async () => true,
    });
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    expect(h.started).toEqual(["a"]);
    expect([...scheduler.running()]).toEqual(["a"]);
    h.gates.get("a")?.open();
    await scheduler.idle();
    expect([...scheduler.running()]).toEqual([]);
  });

  test("ticks that overlap run one pass", async () => {
    const h = harness([{ id: "a" }]);
    const scheduler = createTaskScheduler(h.deps);
    await Promise.all([scheduler.tick(), scheduler.tick()]);
    expect(h.started).toEqual(["a"]);
    h.gates.get("a")?.open();
    await scheduler.idle();
  });

  test("a claim another process won does not start the run", async () => {
    const h = harness([{ id: "a" }]);
    const scheduler = createTaskScheduler({ ...h.deps, claim: async () => false });
    await scheduler.tick();
    expect(h.started).toEqual([]);
    expect([...scheduler.running()]).toEqual([]);
  });

  test("concurrency 1: the second due task waits for a tick after the first ends", async () => {
    const h = harness([{ id: "a" }, { id: "b" }], 1);
    const scheduler = createTaskScheduler(h.deps);
    await scheduler.tick();
    expect(h.started).toEqual(["a"]);
    await scheduler.tick();
    expect(h.started).toEqual(["a"]);
    h.gates.get("a")?.open();
    await scheduler.idle();
    await scheduler.tick();
    expect(h.started).toEqual(["a", "b"]);
    h.gates.get("b")?.open();
    await scheduler.idle();
  });

  test("concurrency 2 starts both", async () => {
    const h = harness([{ id: "a" }, { id: "b" }], 2);
    const scheduler = createTaskScheduler(h.deps);
    await scheduler.tick();
    expect(h.started).toEqual(["a", "b"]);
    h.gates.get("a")?.open();
    h.gates.get("b")?.open();
    await scheduler.idle();
  });

  test("a failing store or run is logged and the loop carries on", async () => {
    const h = harness([{ id: "a" }]);
    const broken = createTaskScheduler({
      ...h.deps,
      listDue: async () => {
        throw new Error("down");
      },
    });
    await broken.tick();
    const failing = createTaskScheduler({
      ...h.deps,
      run: async () => {
        throw new Error("boom");
      },
    });
    await failing.tick();
    await failing.idle();
    expect(h.errors).toEqual(["task tick failed", "task run failed"]);
    expect([...failing.running()]).toEqual([]);
  });
});
