import { describe, expect, test } from "bun:test";

import type { DataMode } from "@/infrastructure/data-mode-policy";
import type { AppendInput } from "@/packages/audit/append";

import { createRunTask, type RunTaskDeps, type TaskRunResult } from "./run-task";
import type { DueTaskRow } from "./task-model";

const TASK: DueTaskRow = {
  id: "task-1",
  userId: "app-user-synthetic-1",
  actorId: "local",
  threadId: "thread-1",
  skill: "sleep",
  sealedQuestion: "sealed",
  modelId: "qwen3:4b",
  schedule: { kind: "daily", time: "08:00", timeZone: "Europe/Zurich" },
  nextRunAt: new Date("2026-01-15T07:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const CONTEXT = { scheduledFor: new Date("2026-01-15T07:00:00Z"), missed: 0 };

const harness = (
  mode: DataMode,
  options: Readonly<{ open?: boolean; auditFails?: boolean; lockOnRead?: boolean }> = {},
) => {
  const audits: AppendInput[] = [];
  const turns: string[] = [];
  const finished: TaskRunResult[] = [];
  const vaultChecks: string[] = [];
  const deps: RunTaskDeps = {
    dataMode: () => mode,
    vaultOpen: (actorId) => {
      vaultChecks.push(actorId);
      return options.open ?? false;
    },
    openQuestion: async () => {
      if (options.lockOnRead) throw new Error("PersonalDataLockedError");
      return "How did I sleep this week?";
    },
    runTurn: async (input) => {
      turns.push(`${input.skill} ${input.question} ${input.modelId}`);
      return { status: "complete", turnId: "turn-9", threadId: input.threadId };
    },
    appendAudit: async (input) => {
      if (options.auditFails) throw new Error("audit down");
      audits.push(input);
      return {};
    },
    finish: async (_task, result) => {
      finished.push(result);
    },
    logError: () => undefined,
  };
  return { deps, audits, turns, finished, vaultChecks };
};

describe("createRunTask", () => {
  test("personal mode, vault locked: skipped, audited as skipped, no turn", async () => {
    const h = harness("personal", { open: false });
    const result = await createRunTask(h.deps)(TASK, CONTEXT);
    expect(result).toEqual({
      status: "skipped-locked",
      turnId: null,
      threadId: "thread-1",
    });
    expect(h.turns).toEqual([]);
    expect(h.vaultChecks).toEqual(["local"]);
    expect(h.audits).toEqual([
      {
        actor: "local",
        sessionId: "task-1",
        subjectRef: null,
        tool: "task.run",
        args: {
          taskId: "task-1",
          skill: "sleep",
          modelId: "qwen3:4b",
          scheduledFor: "2026-01-15T07:00:00.000Z",
          missed: 0,
        },
        result: { decision: "skipped: locked" },
        rowCount: 0,
      },
    ]);
    expect(h.finished).toEqual([result]);
  });

  test("personal mode, vault open: audited as run, then the turn", async () => {
    const h = harness("personal", { open: true });
    const result = await createRunTask(h.deps)(TASK, CONTEXT);
    expect(result).toEqual({
      status: "complete",
      turnId: "turn-9",
      threadId: "thread-1",
    });
    expect(h.audits.map((row) => row.result)).toEqual([{ decision: "run" }]);
    expect(h.turns).toEqual(["sleep How did I sleep this week? qwen3:4b"]);
  });

  test("synthetic mode runs without asking the vault", async () => {
    const h = harness("synthetic");
    const result = await createRunTask(h.deps)(TASK, CONTEXT);
    expect(result.status).toBe("complete");
    expect(h.vaultChecks).toEqual([]);
  });

  test("an audit row that cannot be written stops the run", async () => {
    const h = harness("synthetic", { auditFails: true });
    const result = await createRunTask(h.deps)(TASK, CONTEXT);
    expect(result).toEqual({ status: "failed", turnId: null, threadId: "thread-1" });
    expect(h.turns).toEqual([]);
  });

  test("a vault that locks before the question is read skips the run", async () => {
    const h = harness("personal", { open: true, lockOnRead: true });
    const result = await createRunTask(h.deps)(TASK, CONTEXT);
    expect(result).toEqual({
      status: "skipped-locked",
      turnId: null,
      threadId: "thread-1",
    });
    expect(h.turns).toEqual([]);
  });

  test("a turn that throws is recorded as failed", async () => {
    const h = harness("synthetic");
    const result = await createRunTask({
      ...h.deps,
      runTurn: async () => {
        throw new Error("down");
      },
    })(TASK, CONTEXT);
    expect(result).toEqual({ status: "failed", turnId: null, threadId: "thread-1" });
  });
});
