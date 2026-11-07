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

describe("refused steps", () => {
  const ran: TraceStep = { id: "r", label: "Reading HRV", state: "done" };
  const empty: TraceStep = { id: "e", label: "No data: NO_ROWS", state: "skipped" };
  const gated: TraceStep = {
    id: "g",
    label: "Refused: VIEW_NOT_ALLOWED",
    state: "refused",
  };

  test("are not counted as used and are named apart", () => {
    expect(traceHeadline({ state: "done", steps: [ran, gated], elapsedMs: 3_000 })).toBe(
      "Used 1 tool in 3.0s; 1 call was refused",
    );
    expect(
      traceHeadline({
        state: "done",
        steps: [ran, empty, gated, gated],
        elapsedMs: null,
      }),
    ).toBe("Used 2 tools; 2 calls were refused");
    expect(traceAnnouncement("done", [ran, gated])).toBe(
      "Done. Used 1 tool; 1 call was refused.",
    );
  });

  test("when none ran, the line says only what was refused", () => {
    expect(traceHeadline({ state: "done", steps: [gated], elapsedMs: 3_000 })).toBe(
      "1 tool call was refused",
    );
    expect(traceHeadline({ state: "done", steps: [gated, gated], elapsedMs: null })).toBe(
      "2 tool calls were refused",
    );
    expect(traceAnnouncement("done", [gated])).toBe("Done. 1 tool call was refused.");
    expect(traceHeadline({ state: "failed", steps: [gated], elapsedMs: null })).toBe(
      "Stopped; 1 tool call was refused",
    );
    expect(traceAnnouncement("failed", [ran, gated])).toBe(
      "Stopped after 1 tool; 1 call was refused.",
    );
  });

  test("a lookup that ran and found nothing still counts as used", () => {
    expect(traceHeadline({ state: "done", steps: [empty], elapsedMs: null })).toBe(
      "Used 1 tool",
    );
  });
});
