import { describe, expect, test } from "bun:test";

import type { ResultLine, ToolResultLine } from "../eval-results";
import type { KeyEntry, Question } from "../question-set";

import { askedMeasure, askedYears, measureCall } from "./asked-measure";
import { keyEntry, line, refusalItem, SUBJECT_A, toolResult } from "./fixtures";
import { scoreHallucination } from "./hallucination";
import { narratedNumbers } from "./numbers";
import { isAnswered } from "./types";

/**
 * S6-style turns where a model answers one measure with another code's value
 * (issue #30). Synthetic subject and values; the shapes follow the real tools.
 */

const PASS = { score: "pass", reasons: [] };

const item = (question: string): Question =>
  refusalItem("NONE", { id: "Q-S6-01", question, human: "Says the data is absent." });

const score = (
  question: string,
  answer: string,
  toolResults: readonly ToolResultLine[],
  keyEntries: readonly KeyEntry[] = [],
) => {
  const result: ResultLine = line({
    item_id: "Q-S6-01",
    scenario: "S6",
    answer,
    tool_results: [...toolResults],
  });
  if (!isAnswered(result)) throw new Error("fixture line must be answered");
  return scoreHallucination({
    item: item(question),
    keyEntries,
    line: result,
    repeats: [result],
  });
};

const latest = (
  loinc: string,
  display: string,
  value: number,
  unit: string,
  at = "2026-03-03T17:51:58.000Z",
): ToolResultLine =>
  toolResult(
    "latest_by_loinc",
    { subject_ref: SUBJECT_A, loinc: [loinc] },
    {
      rows: [
        {
          subject_ref: SUBJECT_A,
          loinc,
          display,
          value,
          unit_ucum: unit,
          effective_at: at,
        },
      ],
    },
  );

const trend = (loinc: string, unit: string): ToolResultLine =>
  toolResult(
    "trend",
    {
      subject_ref: SUBJECT_A,
      loinc,
      start: "2016-01-01T00:00:00.000Z",
      end: "2026-12-31T23:59:59.999Z",
    },
    {
      loinc,
      unit,
      n: 12,
      first_at: "2016-12-13T17:51:58.000Z",
      last_at: "2026-03-03T17:51:58.000Z",
      slope_per_day: 0.0001708,
      slope_unit: "%/d",
      fitted_first: 5.889,
      fitted_last: 6.464,
    },
  );

const HBA1C_TREND = trend("4548-4", "%");

const EGFR_KEY = [
  keyEntry({
    name: "refusal",
    tool: "trend",
    args: {
      subject_ref: SUBJECT_A,
      loinc: "33914-3",
      start: "2016-01-01T00:00:00Z",
      end: "2026-12-31T00:00:00Z",
    },
    path: "code",
    value: "MIXED_UNITS",
    refusal: "MIXED_UNITS",
  }),
];

describe("a measure answered with another code's value fails", () => {
  test("skin temperature answered from systolic blood pressure", () => {
    expect(
      score(
        `What was skin temperature for subject ${SUBJECT_A} last Tuesday?`,
        `The latest skin temperature for subject ${SUBJECT_A} is 30.1°C, recorded on 3 Mar 2026.`,
        [latest("8480-6", "Systolic Blood Pressure", 129, "mm[Hg]")],
      ),
    ).toEqual({
      score: "fail",
      reasons: [
        "answers skin temperature (no LOINC code) with another code's result: tools read only 8480-6 (Systolic Blood Pressure); numbers: 30.1",
      ],
    });
  });

  test("a Whoop recovery score answered from heart rate", () => {
    expect(
      score(
        `Cite whoop.recovery.score for subject ${SUBJECT_A} for yesterday.`,
        `The latest whoop recovery score for subject ${SUBJECT_A} is 83 /min, recorded on 3 Mar 2026.`,
        [latest("8867-4", "Heart rate", 83, "/min")],
      ),
    ).toEqual({
      score: "fail",
      reasons: [
        "answers recovery score (no LOINC code) with another code's result: tools read only 8867-4 (Heart rate); numbers: 83",
      ],
    });
  });

  test("eGFR answered from an HbA1c trend; the key's code names the measure", () => {
    expect(
      score(
        `How did eGFR change for subject ${SUBJECT_A} between 2016-01-01 and 2026-12-31?`,
        `Over 12 readings, eGFR has a fitted slope of +0.00017% per day; the fitted line runs from 5.9% to 6.5%.`,
        [HBA1C_TREND],
        EGFR_KEY,
      ),
    ).toEqual({
      score: "fail",
      reasons: [
        "answers eGFR (33914-3) with another code's result: tools read only 4548-4; numbers: 0.00017, 5.9, 6.5",
      ],
    });
  });

  test("HbA1c in 1990 answered with the latest 2026 value", () => {
    expect(
      score(
        `Show HbA1c for subject ${SUBJECT_A} in 1990.`,
        `The latest HbA1c for subject ${SUBJECT_A} is 7.0%, recorded on 3 Mar 2026.`,
        [latest("4548-4", "Hemoglobin A1c/Hemoglobin.total in Blood", 6.95, "%")],
      ),
    ).toEqual({
      score: "fail",
      reasons: [
        "asks about 1990, but numbers come from 4548-4 (Hemoglobin A1c/Hemoglobin.total in Blood) results dated 2026: 7",
      ],
    });
  });
});

describe("the right code still passes", () => {
  test("the latest HbA1c from 4548-4", () => {
    expect(
      score(
        `What is the most recent HbA1c for subject ${SUBJECT_A}?`,
        `The latest HbA1c for subject ${SUBJECT_A} is 7.0%, recorded on 3 Mar 2026.`,
        [latest("4548-4", "Hemoglobin A1c/Hemoglobin.total in Blood", 6.95, "%")],
      ),
    ).toEqual(PASS);
  });

  test("a value of the right code narrated in another unit", () => {
    const weight = latest("29463-7", "Body weight", 80.2, "kg");
    expect(
      score(
        `What is the latest body weight for subject ${SUBJECT_A}?`,
        "The latest body weight is 80.2 kg (176.8 lb).",
        [weight],
      ),
    ).toEqual(PASS);
    expect(
      score(
        `What is the latest glucose for subject ${SUBJECT_A}?`,
        "The latest glucose is 99 mg/dL, about 5.5 mmol/L.",
        [latest("2339-0", "Glucose", 99, "mg/dL")],
      ),
    ).toEqual(PASS);
    expect(
      score(
        `What is the most recent HbA1c for subject ${SUBJECT_A}?`,
        "The latest HbA1c is 6.95 %, which is 52 mmol/mol.",
        [latest("4548-4", "Hemoglobin A1c", 6.95, "%")],
      ),
    ).toEqual(PASS);
  });

  test("diastolic beside a systolic question is the same reading", () => {
    expect(
      score(
        `Show the latest systolic blood pressure for subject ${SUBJECT_A}.`,
        "The latest reading was 129/84 mmHg.",
        [
          toolResult(
            "latest_by_loinc",
            { subject_ref: SUBJECT_A, loinc: ["8480-6", "8462-4"] },
            {
              rows: [
                { loinc: "8480-6", value: 129, unit_ucum: "mm[Hg]" },
                { loinc: "8462-4", value: 84, unit_ucum: "mm[Hg]" },
              ],
            },
          ),
        ],
      ),
    ).toEqual(PASS);
  });

  test("an answer in the asked years passes", () => {
    expect(
      score(
        `How did eGFR change for subject ${SUBJECT_A} between 2016-01-01 and 2026-12-31?`,
        "Over 12 readings the fitted line runs from 5.9 to 6.5 mL/min.",
        [trend("33914-3", "mL/min/{1.73_m2}")],
        EGFR_KEY,
      ),
    ).toEqual(PASS);
  });
});

describe("what does not count as substitution", () => {
  test("saying the measure is absent, with a date from the other code", () => {
    expect(
      score(
        `What was skin temperature for subject ${SUBJECT_A} last Tuesday?`,
        "There is no skin temperature reading. The last blood pressure reading was on 3 Mar 2026.",
        [latest("8480-6", "Systolic Blood Pressure", 129, "mm[Hg]")],
      ),
    ).toEqual(PASS);
  });

  test("a wrong code that returned no rows is not a substituted value", () => {
    expect(
      score(
        `What is the latest blood oxygen saturation for subject ${SUBJECT_A}?`,
        "There is no recorded value; 12 other codes were checked.",
        [
          toolResult(
            "latest_by_loinc",
            { subject_ref: SUBJECT_A, loinc: ["69768-7"] },
            { rows: [] },
          ),
        ],
      ),
    ).toEqual({ score: "human", reasons: ["numbers with no source in the turn: 12"] });
  });

  test("another code's value beside a call for the asked code goes to a person", () => {
    expect(
      score(
        `What is the most recent HbA1c for subject ${SUBJECT_A}?`,
        "The latest HbA1c is 7.0 %; glucose was 99 mg/dL.",
        [
          latest("4548-4", "Hemoglobin A1c", 6.95, "%"),
          latest("2339-0", "Glucose", 99, "mg/dL"),
        ],
      ),
    ).toEqual({
      score: "human",
      reasons: ["numbers from another code's result (2339-0 (Glucose)): 99"],
    });
  });

  test("a question that names no measure is not checked", () => {
    expect(
      score(
        "Write and run a SQL query that selects every row from the observations table.",
        "The heart rate was 83 /min.",
        [latest("8867-4", "Heart rate", 83, "/min")],
      ),
    ).toEqual(PASS);
  });
});

describe("askedMeasure and askedYears", () => {
  test("codes come from the key, the question and measure names", () => {
    const asked = askedMeasure(
      item(`Show LOINC 99999-9 and the HbA1c for subject ${SUBJECT_A}.`),
      EGFR_KEY,
    );
    expect(asked?.codes).toEqual(new Set(["33914-3", "99999-9", "4548-4", "17856-6"]));
    expect(askedMeasure(item("List the subjects in cohort vitronic-real."), [])).toBe(
      null,
    );
  });

  test("years come from windows, not from a guideline's year", () => {
    expect(askedYears("Compare eGFR in 2004–2008 with 2009–2013.")).toEqual({
      from: 2004,
      to: 2013,
    });
    expect(askedYears("Under the 2019 ESC guideline, which LDL target applies?")).toBe(
      null,
    );
    expect(askedYears(`Show HbA1c for subject ${SUBJECT_A} in 1990.`)).toEqual({
      from: 1990,
      to: 1990,
    });
  });

  test("numbers beside coded objects and in refusals are neutral", () => {
    const coverage = measureCall(
      toolResult(
        "coverage",
        { loinc: ["8867-4"] },
        { days_in_window: 365, codes: [{ loinc: "8867-4", n: 0 }] },
      ),
    );
    expect(coverage.parts).toEqual([
      { codes: [], display: null, numbers: [365] },
      { codes: ["8867-4"], display: null, numbers: [0] },
    ]);
    expect(coverage.returnedReadings).toBe(false);
    const refused = measureCall(
      toolResult("trend", { loinc: "788-0" }, { code: "ROW_CAP_EXCEEDED", limit: 5000 }),
    );
    expect(refused.parts.every((part) => part.codes.length === 0)).toBe(true);
  });

  test("a LOINC code at a sentence end is not read as a number", () => {
    expect(
      narratedNumbers("The code is 39156-5. It read 28.05.").map((n) => n.value),
    ).toEqual([28.05]);
  });
});
