import { describe, expect, test } from "bun:test";
import {
  answerSection,
  numberMatches,
  numbersIn,
  prefillBefore,
  probeTruth,
  statesValue,
} from "./values";

describe("numbersIn", () => {
  test("leaves out subject ids, LOINC codes and dates", () => {
    expect(
      numbersIn(
        "Subject 0003d725-4f98-8458-b832-4da2c477048c, LOINC 93832-4: 410 min on 1 Oct 2026 (2026-10-01T07:00:00.000Z).",
      ),
    ).toEqual([410]);
  });

  test("leaves out digits inside words", () => {
    expect(numbersIn("HbA1c is 6.8% and SpO2 95%")).toEqual([6.8, 95]);
  });

  test("reads decimals, negatives and thousands separators", () => {
    expect(numbersIn("8,432 steps, 36.6 and -2.5")).toEqual([8432, 36.6, -2.5]);
  });
});

describe("answerSection", () => {
  test("returns the text under ## Answer only", () => {
    expect(
      answerSection("## Reasoning\n12\n\n## Answer\nIt is 410 min.\n\n## Uncertainty\n3"),
    ).toBe("\nIt is 410 min.\n");
    expect(answerSection("no headings 5")).toBe("no headings 5");
  });
});

describe("statesValue", () => {
  test("matches an exact number only", () => {
    expect(statesValue("The latest is 410 min.", [410])).toBe(true);
    expect(statesValue("The latest is 41 min.", [410])).toBe(false);
    expect(statesValue("BMI 27.3", [27.31, 27.3])).toBe(true);
  });
});

describe("probeTruth", () => {
  const ref = "0003d725-4f98-8458-b832-4da2c477048c";
  const messages = [
    { role: "system", content: "sys" },
    {
      role: "user",
      content: `Which sleep duration value was recorded last for subject ${ref}?`,
    },
    { role: "assistant", content: null, tool_calls: [] },
    {
      role: "tool",
      content: JSON.stringify({
        rows: [{ subject_ref: ref, loinc: "93832-4", value: 410, unit_ucum: "min" }],
      }),
    },
    {
      role: "assistant",
      content: `## Reasoning\nOne row.\n\n## Answer\nThe latest sleep duration for subject ${ref} is 410 min, recorded on 1 Oct 2026.\n\n## Uncertainty\nOne reading.`,
    },
  ];

  test("takes the question, the tool value and the stated numbers", () => {
    expect(probeTruth(messages)).toEqual({
      question: `Which sleep duration value was recorded last for subject ${ref}?`,
      system: "sys",
      loinc: "93832-4",
      unit: "min",
      numbers: [410],
      prefill:
        "## Reasoning\nOne row.\n\n## Answer\nThe latest sleep duration for subject " +
        ref +
        " is ",
    });
  });

  test("is null when the tool returned no numeric row", () => {
    expect(
      probeTruth([
        messages[0],
        messages[1],
        { role: "tool", content: '{"code":"SUBJECT_SCOPE_VIOLATION"}' },
      ]),
    ).toBeNull();
    expect(
      probeTruth([messages[0], messages[1], { role: "tool", content: '{"rows":[]}' }]),
    ).toBeNull();
  });
});

describe("numberMatches", () => {
  test("keeps the positions of the numbers in the original text", () => {
    const text = "On 1 Oct 2026 subject 0003d725-4f98-8458-b832-4da2c477048c had 7 rows";
    expect(numberMatches(text)).toEqual([{ value: 7, index: text.indexOf("7 rows") }]);
  });
});

describe("prefillBefore", () => {
  test("cuts the answer just before the first true number", () => {
    expect(
      prefillBefore("It returned one row: 410 min. The latest is 410 min.", [410]),
    ).toBe("It returned one row: ");
    expect(prefillBefore("Code 93832-4 had 5 readings and 410 min", [410])).toBe(
      "Code 93832-4 had 5 readings and ",
    );
    expect(prefillBefore("No value here", [410])).toBeNull();
  });
});
