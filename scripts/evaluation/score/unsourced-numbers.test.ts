import { describe, expect, test } from "bun:test";

import type { ResultLine, ToolResultLine } from "../eval-results";
import { unsourcedFigures } from "../report";

import { line, refusalItem, SUBJECT_A, toolResult } from "./fixtures";
import { scoreHallucination, unsourcedNumberCount } from "./hallucination";
import { type AnsweredLine, isAnswered } from "./types";

/**
 * The unsourced-number metric: counted by the matcher the answer column uses,
 * reported beside hallucination and never changing its verdict.
 */

const QUESTION = `What is the latest systolic blood pressure for subject ${SUBJECT_A}?`;
const item = refusalItem("NONE", { id: "Q-S6-01", question: QUESTION, human: "-" });

const answered = (answer: string, tools: readonly ToolResultLine[]): AnsweredLine => {
  const result: ResultLine = line({
    item_id: "Q-S6-01",
    scenario: "S6",
    answer,
    tool_results: [...tools],
  });
  if (!isAnswered(result)) throw new Error("fixture line must be answered");
  return result;
};

const SYSTOLIC = toolResult(
  "latest_by_loinc",
  { subject_ref: SUBJECT_A, loinc: ["8480-6"] },
  {
    codes: [
      {
        loinc: "8480-6",
        display: "Systolic Blood Pressure",
        unit_ucum: "mm[Hg]",
        value: 129,
        effective: "2026-03-03T17:51:58.000Z",
      },
    ],
  },
);

describe("unsourcedNumberCount", () => {
  test("counts numbers no tool or the question gives; dates and 0 to 10 are left out", () => {
    const text =
      "Systolic was 129 mmHg (17.2 kPa) on 3 Mar 2026, 2 readings; 141 is a guess.";
    const result = answered(text, [SYSTOLIC]);
    expect(unsourcedNumberCount({ item, line: result })).toBe(1);
    // The verdict is the one hallucination gave before: 141 already goes to a person.
    expect(
      scoreHallucination({ item, keyEntries: [], line: result, repeats: [] }),
    ).toEqual({ score: "human", reasons: ["numbers with no source in the turn: 141"] });
  });

  test("a fully sourced reply counts 0 and still passes", () => {
    const result = answered("Systolic was 129 mmHg.", [SYSTOLIC]);
    expect(unsourcedNumberCount({ item, line: result })).toBe(0);
    expect(
      scoreHallucination({ item, keyEntries: [], line: result, repeats: [] }).score,
    ).toBe("pass");
  });

  test("is null where hallucination does not apply", () => {
    const other = {
      ...item,
      criteria: item.criteria.filter((c) => c !== "hallucination"),
    };
    expect(
      unsourcedNumberCount({ item: other, line: answered("141 mmHg.", [SYSTOLIC]) }),
    ).toBe(null);
  });
});

describe("unsourcedFigures", () => {
  test("sums the counts over answers hallucination scored", () => {
    const scored = [3, 0, null, 1].map((unsourcedNumbers) => ({ unsourcedNumbers }));
    expect(unsourcedFigures({ scored })).toEqual({
      answers: 3,
      numbers: 4,
      withAny: 2,
    });
  });
});
