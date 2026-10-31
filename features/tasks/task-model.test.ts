import { describe, expect, test } from "bun:test";

import type { Schedule } from "./schedule";
import {
  leavesNotice,
  runStatusOf,
  scheduleColumns,
  scheduleOfColumns,
  taskChangeEvent,
} from "./task-model";

describe("schedule columns", () => {
  const schedules: readonly Schedule[] = [
    { kind: "daily", time: "08:00", timeZone: "Europe/Zurich" },
    { kind: "weekly", weekday: 1, time: "07:30", timeZone: "Europe/Zurich" },
    { kind: "interval", minutes: 360, timeZone: "Europe/Zurich" },
  ];

  test("round-trip every kind", () => {
    for (const schedule of schedules) {
      expect(scheduleOfColumns(scheduleColumns(schedule))).toEqual(schedule);
    }
  });

  test("weekly is stored with its weekday", () => {
    expect(scheduleColumns(schedules[1] as Schedule)).toEqual({
      scheduleKind: "weekly",
      timeOfDay: "07:30",
      weekday: 1,
      intervalMinutes: null,
      timeZone: "Europe/Zurich",
    });
  });

  test("columns that make no schedule give null", () => {
    expect(
      scheduleOfColumns({
        scheduleKind: "weekly",
        timeOfDay: "07:30",
        weekday: null,
        intervalMinutes: null,
        timeZone: "Europe/Zurich",
      }),
    ).toBeNull();
    expect(
      scheduleOfColumns({
        scheduleKind: "monthly",
        timeOfDay: "07:30",
        weekday: null,
        intervalMinutes: null,
        timeZone: "Europe/Zurich",
      }),
    ).toBeNull();
  });
});

describe("statuses and notices", () => {
  test("reads only known statuses", () => {
    expect(runStatusOf("skipped-locked")).toBe("skipped-locked");
    expect(runStatusOf("odd")).toBeNull();
    expect(runStatusOf(null)).toBeNull();
  });

  test("a notice only when turned on and a message was posted", () => {
    expect(leavesNotice(false, "complete")).toBe(false);
    expect(leavesNotice(true, "complete")).toBe(true);
    expect(leavesNotice(true, "refused")).toBe(true);
    expect(leavesNotice(true, "skipped-locked")).toBe(false);
    expect(leavesNotice(true, "interrupted")).toBe(false);
  });
});

describe("taskChangeEvent", () => {
  test("names the change, the task and the skill, nothing else", () => {
    expect(taskChangeEvent("local", { id: "task-1", skill: "sleep" }, "pause")).toEqual({
      actor: "local",
      sessionId: "task-1",
      subjectRef: null,
      tool: "task.pause",
      args: { taskId: "task-1", skill: "sleep" },
      result: { changed: true },
      rowCount: 0,
    });
  });
});
