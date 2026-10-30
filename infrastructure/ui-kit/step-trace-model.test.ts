import { describe, expect, test } from "bun:test";

import {
  currentStep,
  traceAnnouncement,
  traceHeadline,
  type TraceStep,
} from "./step-trace-model";

const steps: readonly TraceStep[] = [
  {
    id: "a",
    label: "Reading resting heart rate, 4 Jul 2026 – 1 Oct 2026",
    state: "done",
  },
  { id: "b", label: "No data: NO_ROWS", state: "skipped" },
  { id: "c", label: "Fitting an HRV trend", state: "current" },
];

describe("currentStep", () => {
  test("is the newest step in progress", () => {
    const two: readonly TraceStep[] = [
      { id: "x", label: "First", state: "current" },
      { id: "y", label: "Second", state: "current" },
    ];
    expect(currentStep(two)?.id).toBe("y");
  });

  test("is null when nothing runs", () => {
    expect(currentStep(steps.slice(0, 2))).toBeNull();
  });
});

describe("traceHeadline", () => {
  test("working: names the step in progress", () => {
    expect(traceHeadline({ state: "working", steps, elapsedMs: 1200 })).toBe(
      "Fitting an HRV trend",
    );
  });

  test("working with no step in progress: the caller's words, or a plain default", () => {
    const idle = steps.slice(0, 2);
    expect(
      traceHeadline({
        state: "working",
        steps: idle,
        elapsedMs: 0,
        workingLabel: "Preparing the answer…",
      }),
    ).toBe("Preparing the answer…");
    expect(traceHeadline({ state: "working", steps: idle, elapsedMs: 0 })).toBe(
      "Working…",
    );
  });

  test("done: counts the steps and the time the trace watched", () => {
    expect(traceHeadline({ state: "done", steps, elapsedMs: 4_260 })).toBe(
      "Used 3 tools in 4.2s",
    );
    expect(
      traceHeadline({ state: "done", steps: steps.slice(0, 1), elapsedMs: 900 }),
    ).toBe("Used 1 tool in 0.9s");
  });

  test("done without a watched clock gives no time", () => {
    expect(traceHeadline({ state: "done", steps, elapsedMs: null })).toBe("Used 3 tools");
  });

  test("failed says where it stopped, with the caller's noun", () => {
    expect(
      traceHeadline({ state: "failed", steps, elapsedMs: 61_000, noun: "step" }),
    ).toBe("Stopped after 3 steps in 1m 01s");
  });
});

describe("traceAnnouncement", () => {
  test("only start and settle have words, and they carry no timer", () => {
    expect(traceAnnouncement("working", steps)).toBe("Working.");
    expect(traceAnnouncement("done", steps)).toBe("Done. Used 3 tools.");
    expect(traceAnnouncement("failed", steps.slice(0, 1))).toBe("Stopped after 1 tool.");
  });
});
