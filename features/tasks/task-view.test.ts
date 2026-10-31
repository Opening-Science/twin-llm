import { describe, expect, test } from "bun:test";

import { nextRunWords, panelIsLive, taskRunLine } from "./task-view";

describe("taskRunLine", () => {
  test("running wins over the last outcome", () => {
    expect(taskRunLine({ running: true, lastStatus: "failed" })).toEqual({
      kind: "lattice",
      state: "working",
      label: "Running now",
    });
  });

  test("each outcome", () => {
    expect(taskRunLine({ running: false, lastStatus: null })).toEqual({ kind: "none" });
    expect(taskRunLine({ running: false, lastStatus: "complete" })).toEqual({
      kind: "lattice",
      state: "done",
      label: "Answered",
    });
    expect(taskRunLine({ running: false, lastStatus: "refused" })).toEqual({
      kind: "lattice",
      state: "error",
      label: "Refused",
    });
    expect(taskRunLine({ running: false, lastStatus: "failed" })).toEqual({
      kind: "lattice",
      state: "error",
      label: "Failed",
    });
    expect(taskRunLine({ running: false, lastStatus: "skipped-locked" })).toEqual({
      kind: "badge",
      tone: "warn",
      label: "Skipped: locked",
    });
    expect(taskRunLine({ running: false, lastStatus: "interrupted" })).toEqual({
      kind: "badge",
      tone: "neutral",
      label: "Interrupted by a restart",
    });
  });
});

describe("nextRunWords and panelIsLive", () => {
  const format = (iso: string) => `at ${iso}`;

  test("paused, unknown and a time", () => {
    expect(
      nextRunWords({ enabled: false, nextRunAt: "2026-01-15T07:00:00Z" }, format),
    ).toBe("Paused");
    expect(nextRunWords({ enabled: true, nextRunAt: null }, format)).toBe("—");
    expect(
      nextRunWords({ enabled: true, nextRunAt: "2026-01-15T07:00:00Z" }, format),
    ).toBe("at 2026-01-15T07:00:00Z");
  });

  test("live while any task is on or running", () => {
    expect(panelIsLive([])).toBe(false);
    expect(panelIsLive([{ enabled: false, running: false }])).toBe(false);
    expect(panelIsLive([{ enabled: false, running: true }])).toBe(true);
    expect(panelIsLive([{ enabled: true, running: false }])).toBe(true);
  });
});
