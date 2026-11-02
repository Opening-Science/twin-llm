import { describe, expect, test } from "bun:test";

import { measureNameOf, toolCard } from "./tool-cards";
import {
  answerTraceState,
  measureNames,
  toolStepLabel,
  toolStepLabels,
  toolStepState,
  reviewStep,
} from "./tool-steps";

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
    ).toBe("Reading resting heart rate, 4 Jul 2026 to 1 Oct 2026");
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
    ).toBe("Summarising 8867-4, 1 Jan 2025 to 31 Dec 2025");
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

describe("measure names from the answer's own data", () => {
  const window = { start: "2024-01-01", end: "2025-12-31" };
  const chart = {
    id: "view-1",
    kind: "chart.timeseries",
    title: "Heart rate, 1 Jan 2024 – 31 Dec 2025",
    spec: {
      measure: "8867-4",
      label: "Heart rate",
      unit: "/min",
      subject: "synthetic-subject-1",
      window,
      points: [{ at: "2024-02-01", value: 63 }],
    },
    sourceAuditIds: ["a1"],
  };
  const latest = [
    {
      subject_ref: "synthetic-subject-1",
      loinc: "8867-4",
      display: "Heart rate",
      value: 87,
      unit_ucum: "/min",
      effective_at: "2025-08-27T00:00:00.000Z",
    },
  ];

  test("measureNameOf reads a chart's label or the asked code's row display", () => {
    expect(measureNameOf({ measure: "8867-4" }, chart)).toBe("Heart rate");
    expect(measureNameOf({ loinc: "8867-4" }, { rows: latest })).toBe("Heart rate");
    expect(measureNameOf({ loinc: "8867-4" }, latest)).toBe("Heart rate");
    expect(measureNameOf({ loinc: "2093-3" }, { rows: latest })).toBeNull();
    expect(measureNameOf({ measure: "8867-4" }, { n: 25, mean: 78.08 })).toBeNull();
  });

  test("a code named by one call names it in every step, code in brackets", () => {
    const cards = [
      done("show_view", { measure: "8867-4", window }, chart),
      done("latest_by_loinc", { loinc: "8867-4" }, { rows: latest }),
      done("summary_stats", { measure: "8867-4", ...window }, { n: 25, mean: 78.08 }),
    ];
    expect(measureNames(cards)).toEqual(new Map([["8867-4", "Heart rate"]]));
    expect(toolStepLabels(cards)).toEqual([
      "Drawing heart rate (8867-4), 1 Jan 2024 to 31 Dec 2025",
      "Reading the latest heart rate (8867-4)",
      "Summarising heart rate (8867-4), 1 Jan 2024 to 31 Dec 2025",
    ]);
  });

  test("an acronym keeps its case; a code nobody named stands alone", () => {
    const named = done("trend", { measure: "4548-4" }, [
      { loinc: "4548-4", display: "HbA1c" },
    ]);
    expect(toolStepLabel(named)).toBe("Fitting a trend of HbA1c (4548-4)");
    expect(toolStepLabels([done("trend", { measure: "2093-3" }, { n: 3 })])).toEqual([
      "Fitting a trend of 2093-3",
    ]);
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

describe("reviewStep (#366)", () => {
  const review = {
    reviewer: "Number check (research)",
    status: "done" as const,
    items: [
      { text: "80", verdict: "supported" as const, note: null, matched: true },
      {
        text: "95.5",
        verdict: "unsupported" as const,
        note: "no row holds it",
        matched: false,
      },
    ],
    skipped: 2,
  };

  test("no check, no step", () => {
    expect(reviewStep(false, null)).toBeNull();
    expect(reviewStep(false, undefined)).toBeNull();
  });

  test("a running check is the step in progress", () => {
    expect(reviewStep(true, null)).toEqual({
      label: "Checking each number against the tool results",
      state: "current",
      lines: [],
    });
  });

  test("a finished check counts what it flagged and lists each number", () => {
    expect(reviewStep(false, review)).toEqual({
      label: "Number check: 1 of 2 numbers flagged",
      state: "done",
      lines: [
        "80: supported",
        "95.5: flagged: no row holds it",
        "2 more numbers were not checked.",
        "Checked by Number check (research), a model that can be wrong.",
      ],
    });
    expect(reviewStep(true, { ...review, status: "failed" })?.state).toBe("failed");
  });

  test("a blocked check shows its refusal first (#414)", () => {
    const step = reviewStep(false, {
      ...review,
      status: "failed",
      refusal: "Not sent: synthetic refusal.",
    });
    expect(step?.state).toBe("failed");
    expect(step?.lines[0]).toBe("Not sent: synthetic refusal.");
  });
});
