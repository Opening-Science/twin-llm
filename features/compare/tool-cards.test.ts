import { describe, expect, test } from "bun:test";

import type { StoredToolPart } from "@/infrastructure/model-response-tool-parts";

import {
  cardOutcome,
  codeSentence,
  lookupLine,
  measureWords,
  midSentence,
  rowCountOfOutput,
  stepLine,
  storedToolCards,
  toolArgs,
  toolCardOf,
} from "./tool-cards";

const TREND_INPUT = {
  subject_ref: "29bbf012",
  loinc: "8867-4",
  start: "2024-01-01",
  end: "2025-12-31",
};

describe("tool arguments in words (SPEC 5.3)", () => {
  test("labels in the card's order, dates as days, windows as start – end", () => {
    expect(toolArgs(TREND_INPUT)).toEqual([
      { label: "Measure", value: "8867-4" },
      { label: "Window", value: "1 Jan 2024 – 31 Dec 2025" },
      { label: "Subject", value: "29bbf012" },
    ]);
    expect(
      toolArgs({
        loinc: "8867-4",
        baseline: { start: "2026-01-01", end: "2026-02-28" },
        target: { start: "2026-03-01", end: "2026-05-31" },
      }).map((arg) => arg.label),
    ).toEqual(["Measure", "Baseline", "Target"]);
  });

  test("search text is clipped at 80 characters", () => {
    const [search] = toolArgs({ query: "x".repeat(120) });
    expect(search?.value.length).toBe(80);
    expect(search?.value.endsWith("…")).toBe(true);
  });
});

describe("measures in words", () => {
  test("a code is named by the call's own output first, then the app's tables", () => {
    const card = { args: [{ label: "Measure", value: "8867-4" }] };
    expect(measureWords(card, {})).toBe("heart rate");
    expect(measureWords(card, { "8867-4": "Pulse rate" })).toBe("pulse rate");
  });

  test("unknown codes read as this measure, or nothing in the export", () => {
    const one = { args: [{ label: "Measure", value: "99999-9" }] };
    expect(measureWords(one, {})).toBe("this measure");
    expect(measureWords(one, {}, null)).toBeNull();
    const two = { args: [{ label: "Measure", value: "99999-9, 88888-8" }] };
    expect(measureWords(two, {})).toBe("these measures");
    const some = { args: [{ label: "Measure", value: "8867-4, 99999-9" }] };
    expect(measureWords(some, {})).toBe("heart rate and one other measure");
  });

  test("common words go lower case mid-sentence; acronyms keep their case", () => {
    expect(midSentence("Heart rate")).toBe("heart rate");
    expect(midSentence("HbA1c")).toBe("HbA1c");
    expect(midSentence("BMI")).toBe("BMI");
  });
});

describe("cards from tool parts (SPEC 5.3, 10.5)", () => {
  test("a running call, then a done call with its row count", () => {
    const running = toolCardOf({
      type: "tool-trend",
      toolCallId: "call-1",
      state: "input-available",
      input: TREND_INPUT,
    });
    expect(running?.state).toBe("running");
    expect(running === null ? "" : stepLine(running)).toBe(
      "Fitting a trend of heart rate, 1 Jan 2024 to 31 Dec 2025",
    );
    const done = toolCardOf({
      type: "tool-trend",
      toolCallId: "call-1",
      state: "output-available",
      input: TREND_INPUT,
      output: { rows: [{}, {}, {}] },
    });
    expect(done?.rowCount).toBe(3);
    expect(done === null ? "" : stepLine(done)).toBe(
      "Fitting a trend of heart rate, 1 Jan 2024 to 31 Dec 2025",
    );
    expect(done === null ? "" : cardOutcome(done)).toBe("Done");
  });

  test("a gate refusal is Refused; a call that ran and found nothing is No data", () => {
    const gated = toolCardOf({
      type: "tool-trend",
      toolCallId: "c",
      state: "output-available",
      input: TREND_INPUT,
      output: { code: "SUBJECT_SCOPE_VIOLATION", error: "x" },
    });
    expect(gated && cardOutcome(gated)).toBe("Refused");
    const empty = toolCardOf({
      type: "tool-trend",
      toolCallId: "c",
      state: "output-available",
      input: TREND_INPUT,
      output: { code: "NO_ROWS", error: "x", loinc: "8867-4" },
    });
    expect(empty && cardOutcome(empty)).toBe("No data");
    expect(empty?.note).toBe("No readings in this range");
    expect(empty === null ? "" : stepLine(empty)).toBe("No readings in this range");
  });

  test("record tools word an empty result as records; unknown codes read generically", () => {
    expect(codeSentence("conditions_timeline", "NO_ROWS")).toBe(
      "No records in this range",
    );
    expect(codeSentence("trend", "SOMETHING_NEW")).toBe("The tool could not answer this");
  });

  test("an error part is Failed with no row count", () => {
    const failed = toolCardOf({
      type: "tool-trend",
      toolCallId: "c",
      state: "output-error",
      input: TREND_INPUT,
    });
    expect(failed && cardOutcome(failed)).toBe("Failed");
    expect(failed?.rowCount).toBeNull();
  });

  test("a stored answer: call id is the step number, the audit row count wins", () => {
    const stored: StoredToolPart[] = [
      {
        seq: 1,
        tool: "trend",
        input: TREND_INPUT,
        output: { rows: [{}, {}] },
        argsSha256: "a",
        resultSha256: "b",
        rowCount: 14,
        at: "2026-11-01T00:00:00.000Z",
      },
      {
        seq: 2,
        tool: "trend",
        input: TREND_INPUT,
        output: { code: "SUBJECT_SCOPE_VIOLATION", error: "x" },
        argsSha256: "c",
        resultSha256: "d",
        rowCount: null,
        at: "2026-11-01T00:00:00.000Z",
      },
    ];
    const [first, second] = storedToolCards(stored);
    expect(first?.id).toBe("1");
    expect(first?.rowCount).toBe(14);
    expect(second?.didNotRun).toBe(true);
  });

  test("the export's lookup line: title, measure, first four arguments, outcome", () => {
    const done = toolCardOf({
      type: "trend",
      toolCallId: "c",
      state: "output-available",
      input: TREND_INPUT,
    });
    expect(done).toBeNull();
    const card = toolCardOf({
      type: "tool-trend",
      toolCallId: "c",
      state: "output-available",
      input: TREND_INPUT,
      output: { rows: [{}] },
    });
    expect(card === null ? "" : lookupLine(card)).toBe(
      "- Fitted a trend: heart rate (measure 8867-4, window 1 Jan 2024 – 31 Dec 2025, subject 29bbf012) · 1 row",
    );
  });
});

describe("a summary call, live (review of #596)", () => {
  const summary = toolCardOf({
    type: "tool-summary_stats",
    toolCallId: "call-2",
    state: "output-available",
    input: { subject_ref: "29bbf012", loinc: "8867-4" },
    output: { n: 2, min: 70, max: 74, mean: 72, unit: "/min" },
  });

  test("its own count gives the rows", () => {
    expect(summary?.rowCount).toBe(2);
  });

  test("the step reads naturally: the measure takes the place of 'a measure'", () => {
    expect(summary === null ? "" : stepLine(summary)).toBe("Summarising heart rate");
  });

  test("counts follow the query tools' audit rules", () => {
    expect(rowCountOfOutput({ n_observations: 12, codes: [{}] })).toBe(12);
    expect(rowCountOfOutput({ rows_read: 40 })).toBe(40);
    expect(rowCountOfOutput({ baseline: { n: 3 }, target: { n: 4 } })).toBe(7);
    expect(rowCountOfOutput({ window_a: { n: 5 }, window_b: { n: 1 } })).toBe(6);
    expect(rowCountOfOutput({ measures: [{ n: 2 }, { n: 3 }] })).toBe(5);
    expect(rowCountOfOutput({ rows: [{}, {}, {}], n: 9 })).toBe(3);
    expect(rowCountOfOutput({ mean: 72 })).toBeNull();
  });
});
