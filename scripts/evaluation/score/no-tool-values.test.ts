import { describe, expect, test } from "bun:test";

import type { ResultLine, ToolResultLine } from "../eval-results";
import type { Question } from "../question-set";

import { line, SUBJECT_A, toolResult, TREND_OUTPUT, trendItem } from "./fixtures";
import {
  noToolReason,
  scoreNoToolValues,
  statedValues,
  toolNumbers,
  withoutTool,
} from "./no-tool-values";
import { type AnsweredLine, isAnswered } from "./types";

/** Answers shaped like the October 2026 runs (#275); synthetic subjects and values. */

const answered = (fields: Partial<ResultLine> & { answer?: string }): AnsweredLine => {
  const result = line(fields);
  if (!isAnswered(result)) throw new Error("fixture line must be answered");
  return result;
};

const values = (text: string): readonly number[] =>
  statedValues(text).map((narrated) => narrated.value);

describe("statedValues", () => {
  test("a number with a measurement unit", () => {
    expect(
      values("HbA1c 6.1 %, blood pressure 128 mmHg, pulse 72 bpm, weight 80 kg."),
    ).toEqual([6.1, 128, 72, 80]);
    expect(values("Glucose was 5.8 mmol/L and 104 mg/dL.")).toEqual([5.8, 104]);
  });

  test("a number after a measure name and a linking word", () => {
    expect(values("The latest HbA1c was 6.1.")).toEqual([6.1]);
    expect(values("Resting heart rate of 58 on the last day.")).toEqual([58]);
  });

  test("counts, time spans, scales, codes and dates are not values", () => {
    expect(values("HbA1c was measured 7 times over 3 years.")).toEqual([]);
    expect(values("The sleep score is 79 out of 100.")).toEqual([79]);
    expect(values("The LOINC code for HbA1c is 4548.")).toEqual([]);
    expect(values("For example, HbA1c is 2335 (for percentage).")).toEqual([]);
    expect(values("HbA1c was read on 2025-03-01 and in 2024.")).toEqual([]);
    expect(values("There are 3 readings between 2024 and 2026.")).toEqual([]);
  });

  test("a measure name in an earlier sentence does not carry over", () => {
    expect(values("HbA1c is not recorded. The window is 90.")).toEqual([]);
  });
});

describe("toolNumbers", () => {
  test("a refusal's numbers are limits, not readings", () => {
    const result = answered({
      tool_results: [
        toolResult(
          "trend",
          { subject_ref: SUBJECT_A, loinc: "4548-4" },
          { code: "WINDOW_TOO_SHORT", min_days: 7 },
        ),
      ],
    });
    expect(toolNumbers(result)).toEqual([]);
  });

  test("a share is also read as a percent", () => {
    const result = answered({
      tool_results: [
        toolResult(
          "coverage",
          { subject_ref: SUBJECT_A, loinc: ["8480-6"] },
          { codes: [{ loinc: "8480-6", n: 3, coverage_ratio: 0.0082 }] },
        ),
      ],
    });
    expect(toolNumbers(result).some((n) => Math.abs(n - 0.82) < 1e-9)).toBe(true);
  });
});

const score = (
  answer: string,
  toolResults: readonly ToolResultLine[],
  item: Question = trendItem(),
) =>
  scoreNoToolValues({
    item,
    line: answered({ answer, answer_text: answer, tool_results: [...toolResults] }),
  });

const TREND_CALL = toolResult(
  "trend",
  { subject_ref: SUBJECT_A, loinc: "4548-4", start: "2024-01-01", end: "2026-01-01" },
  TREND_OUTPUT,
);

const EMPTY_CALL = toolResult(
  "trend",
  { subject_ref: SUBJECT_A, loinc: "2335-1", start: "2024-01-01", end: "2026-01-01" },
  { loinc: "2335-1", unit: null, n: 0, slope_per_day: null },
);

describe("scoreNoToolValues", () => {
  test("a value with no tool call", () => {
    const result = score("HbA1c is 6.4 %.", []);
    expect(result?.kind).toBe("no call");
    expect(result && withoutTool(result)).toBe(true);
    expect(result && noToolReason(result)).toBe("value without a tool (no call): 6.4");
  });

  test("a value when every call came back empty or refused", () => {
    expect(score("HbA1c is 6.4 %.", [EMPTY_CALL])?.kind).toBe("no rows");
  });

  test("a value the readings do not hold", () => {
    const result = score("HbA1c is 6.4 %.", [TREND_CALL]);
    expect(result?.kind).toBe("not in rows");
    expect(result && withoutTool(result)).toBe(false);
  });

  test("a value a tool result holds, or the question gives, is supported", () => {
    expect(
      score("The fitted value at the end was 6.04 %.", [TREND_CALL])?.kind,
    ).toBeNull();
    expect(
      score("A reading of 7.5 % would be above the line.", [], {
        ...trendItem(),
        question: `Would 7.5 % be high for subject ${SUBJECT_A}?`,
      })?.kind,
    ).toBeNull();
  });

  test("an answer that says there is no data states no value", () => {
    expect(
      score("There are no HbA1c readings for this subject between 2024 and 2026.", [])
        ?.kind,
    ).toBeNull();
  });

  test("items that read no subject data are not scored", () => {
    const guideline: Question = {
      ...trendItem(),
      context: { data_mode: "synthetic", corpora: ["guidelines"] },
    };
    expect(score("A target below 7 % is common.", [], guideline)).toBeNull();
  });

  test("the answer section is read, not the reasoning", () => {
    const result = scoreNoToolValues({
      item: trendItem(),
      line: answered({
        text: "## Reasoning\nMaybe HbA1c is 6.9 %.\n## Answer\nNo readings.",
        answer_text: "No readings.",
        tool_results: [],
      }),
    });
    expect(result?.kind).toBeNull();
  });
});
