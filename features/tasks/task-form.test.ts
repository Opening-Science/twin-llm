import { describe, expect, test } from "bun:test";

import { readTaskForm, TASK_FORM_COPY } from "./task-form";

const BASE = {
  skill: "sleep",
  threadId: "new",
  question: "  How did synthetic person 1 sleep?  ",
  modelId: "qwen3:4b",
  kind: "daily",
  time: "08:00",
  weekday: "1",
  hours: "6",
  timeZone: "Europe/Zurich",
};

describe("readTaskForm", () => {
  test("a daily task in a new thread, notifications off unless ticked", () => {
    expect(readTaskForm(BASE)).toEqual({
      ok: true,
      task: {
        skill: "sleep",
        threadId: null,
        question: "How did synthetic person 1 sleep?",
        modelId: "qwen3:4b",
        schedule: { kind: "daily", time: "08:00", timeZone: "Europe/Zurich" },
        notify: false,
      },
    });
  });

  test("weekly in an existing thread with notifications on", () => {
    const read = readTaskForm({ ...BASE, kind: "weekly", threadId: "t1", notify: "on" });
    expect(read).toEqual({
      ok: true,
      task: {
        skill: "sleep",
        threadId: "t1",
        question: "How did synthetic person 1 sleep?",
        modelId: "qwen3:4b",
        schedule: {
          kind: "weekly",
          weekday: 1,
          time: "08:00",
          timeZone: "Europe/Zurich",
        },
        notify: true,
      },
    });
  });

  test("every N hours is stored in minutes", () => {
    const read = readTaskForm({ ...BASE, kind: "interval" });
    expect(read.ok && read.task.schedule).toEqual({
      kind: "interval",
      minutes: 360,
      timeZone: "Europe/Zurich",
    });
  });

  test("refusals name what to fix", () => {
    expect(readTaskForm({ ...BASE, skill: "/sleep" })).toEqual({
      ok: false,
      error: TASK_FORM_COPY.skill,
    });
    expect(readTaskForm({ ...BASE, modelId: "" })).toEqual({
      ok: false,
      error: TASK_FORM_COPY.model,
    });
    expect(readTaskForm({ ...BASE, kind: "interval", hours: "1.5" })).toEqual({
      ok: false,
      error: TASK_FORM_COPY.schedule,
    });
    expect(readTaskForm({ ...BASE, kind: "interval", hours: "0" })).toEqual({
      ok: false,
      error: TASK_FORM_COPY.schedule,
    });
    expect(readTaskForm({ ...BASE, time: "8am" })).toEqual({
      ok: false,
      error: TASK_FORM_COPY.schedule,
    });
    expect(readTaskForm({ ...BASE, timeZone: "" })).toEqual({
      ok: false,
      error: TASK_FORM_COPY.schedule,
    });
    expect(readTaskForm({ ...BASE, question: "x".repeat(2_001) })).toEqual({
      ok: false,
      error: TASK_FORM_COPY.question,
    });
  });
});
