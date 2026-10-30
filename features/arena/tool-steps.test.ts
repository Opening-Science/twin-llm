import { describe, expect, test } from "bun:test";

import { toolCard } from "./tool-cards";
import { answerTraceState, toolStepLabel, toolStepState } from "./tool-steps";

// Synthetic calls only.

const done = (tool: string, input: unknown, output: unknown = { n: 3 }) =>
  toolCard({ toolCallId: "c1", tool, state: "output-available", input, output });

describe("toolStepLabel", () => {
  test("a wearable trend names its measure and window", () => {
    expect(
      toolStepLabel(
        done("resting_hr_trend", {
          source: "whoop",
          window: { start: "2026-07-04", end: "2026-10-01" },
        }),
      ),
    ).toBe("Reading resting heart rate, 4 Jul 2026 – 1 Oct 2026");
  });

  test("a cohort read names the measure it was given", () => {
    expect(
      toolStepLabel(
        done("summary_stats", {
          measure: "8867-4",
          subject: "synthetic-subject-1",
          start: "2025-01-01",
          end: "2025-12-31",
        }),
      ),
    ).toBe("Summarising 8867-4, 1 Jan 2025 – 31 Dec 2025");
    expect(toolStepLabel(done("trend", { measure: "whoop.recovery.score" }))).toBe(
      "Fitting a trend of Whoop recovery score",
    );
    expect(toolStepLabel(done("trend", {}))).toBe("Fitting a trend");
    expect(toolStepLabel(done("range_position", { measure: "8867-4" }))).toBe(
      "Placing 8867-4 against its published range",
    );
  });

  test("a refusal reads No data with its code", () => {
    expect(
      toolStepLabel(
        done(
          "summary_stats",
          { measure: "8867-4" },
          { code: "NO_ROWS", error: "synthetic" },
        ),
      ),
    ).toBe("No data: NO_ROWS");
  });

  test("an unknown tool falls back to its card title", () => {
    expect(toolStepLabel(done("lab.some_new_tool", {}))).toBe("Lab some new tool");
  });
});

describe("toolStepState", () => {
  test("maps card states to step states", () => {
    const running = toolCard({
      toolCallId: "r",
      tool: "trend",
      state: "input-available",
    });
    const failed = toolCard({ toolCallId: "f", tool: "trend", state: "output-error" });
    const refused = done("trend", {}, { code: "NO_ROWS", error: "synthetic" });
    expect([running, done("trend", {}), refused, failed].map(toolStepState)).toEqual([
      "current",
      "done",
      "skipped",
      "failed",
    ]);
  });
});

describe("answerTraceState", () => {
  test("the trace settles with the answer", () => {
    expect(answerTraceState("STREAMING")).toBe("working");
    expect(answerTraceState("COMPLETE")).toBe("done");
    expect(answerTraceState("FAILED")).toBe("failed");
  });
});
