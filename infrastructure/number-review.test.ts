import { describe, expect, test } from "bun:test";

import {
  failedReview,
  MAX_REVIEW_NUMBERS,
  MAX_REVIEW_TOOL_CHARS,
  NUMBER_REVIEWER,
  parseReview,
  reviewItemLine,
  reviewNumbers,
  reviewPrompt,
  reviewStepLabel,
  reviewToolText,
} from "./number-review";
import type { NumberSourcePart } from "./number-sources";

/** A synthetic weight series, shaped like the query tools' output. */
const WEIGHTS: NumberSourcePart = {
  toolCallId: "0",
  input: { loinc: "29463-7" },
  output: {
    rows: [
      { loinc: "29463-7", value: 80, unit_ucum: "kg", effective: "2023-01-05" },
      { loinc: "29463-7", value: 81.2, unit_ucum: "kg", effective: "2023-06-01" },
    ],
  },
};

const ANSWER = "Weight went from 80 kg to 81.2 kg, and then to 95.5 kg on 2024-01-02.";

describe("reviewNumbers (#366)", () => {
  test("lists the answer's values with context and what the matcher found, dates left out", () => {
    const { numbers, skipped } = reviewNumbers(ANSWER, [WEIGHTS]);
    expect(skipped).toBe(0);
    expect(numbers.map(({ text, matched }) => [text, matched])).toEqual([
      ["80", true],
      ["81.2", true],
      ["95.5", false],
    ]);
    expect(numbers[2]?.context).toBe(
      "went from 80 kg to 81.2 kg, and then to 95.5 kg on 2024-01-02.",
    );
  });

  test("checks at most MAX_REVIEW_NUMBERS and counts the rest", () => {
    const many = Array.from({ length: MAX_REVIEW_NUMBERS + 3 }, (_, i) =>
      String(100 + i),
    ).join(", ");
    const { numbers, skipped } = reviewNumbers(many, []);
    expect([numbers.length, skipped]).toEqual([MAX_REVIEW_NUMBERS, 3]);
  });
});

describe("reviewToolText", () => {
  test("numbers each result and says when there was none", () => {
    expect(reviewToolText([])).toBe("(this answer used no tool)");
    expect(reviewToolText([{ toolName: "trend", output: { n: 2 } }])).toBe(
      '[1] trend: {"n":2}',
    );
  });

  test("cuts long results and says so", () => {
    const text = reviewToolText([
      { toolName: "observations", output: "x".repeat(MAX_REVIEW_TOOL_CHARS * 2) },
    ]);
    expect(text.endsWith("\n(the rest of the tool results was cut)")).toBe(true);
    expect(text.length).toBe(
      MAX_REVIEW_TOOL_CHARS + "\n(the rest of the tool results was cut)".length,
    );
  });
});

describe("reviewPrompt", () => {
  test("puts the tool results, the answer and the numbered list in that order", () => {
    const { numbers } = reviewNumbers("HbA1c was 6.1 %.", []);
    expect(reviewPrompt("HbA1c was 6.1 %.", "[1] latest: {}", numbers)).toBe(
      [
        "Tool results:",
        "[1] latest: {}",
        "",
        "Answer:",
        "HbA1c was 6.1 %.",
        "",
        "Numbers to check:",
        '1. 6.1 (in: "HbA1c was 6.1 %.")',
      ].join("\n"),
    );
  });
});

describe("parseReview", () => {
  const { numbers } = reviewNumbers(ANSWER, [WEIGHTS]);

  test("reads one verdict per line, with the reason for a flagged number", () => {
    expect(
      parseReview(
        "1. supported\n2) Supported\n3. unsupported: no tool result has 95.5",
        numbers,
      ),
    ).toEqual([
      { text: "80", verdict: "supported", note: null, matched: true },
      { text: "81.2", verdict: "supported", note: null, matched: true },
      {
        text: "95.5",
        verdict: "unsupported",
        note: "no tool result has 95.5",
        matched: false,
      },
    ]);
  });

  test("leaves a number the reply skips unchecked and ignores lines it did not ask for", () => {
    expect(
      parseReview(
        "<think>let me see</think>\n1. supported\n7. unsupported: what\nThat is all.",
        numbers,
      ).map((item) => item.verdict),
    ).toEqual(["supported", "unchecked", "unchecked"]);
  });

  test("the first verdict for a number wins", () => {
    expect(parseReview("1. unsupported: odd\n1. supported", numbers)[0]?.verdict).toBe(
      "unsupported",
    );
  });
});

describe("failedReview and the step line", () => {
  const { numbers } = reviewNumbers(ANSWER, [WEIGHTS]);

  test("a failed check keeps every number unchecked", () => {
    expect(failedReview(numbers, 0)).toEqual({
      reviewer: NUMBER_REVIEWER.name,
      status: "failed",
      items: [
        { text: "80", verdict: "unchecked", note: null, matched: true },
        { text: "81.2", verdict: "unchecked", note: null, matched: true },
        { text: "95.5", verdict: "unchecked", note: null, matched: false },
      ],
      skipped: 0,
    });
    expect(reviewStepLabel(failedReview(numbers, 0))).toBe("Number check could not run");
  });

  test("names how many numbers were flagged", () => {
    const review = {
      reviewer: NUMBER_REVIEWER.name,
      status: "done" as const,
      items: [...parseReview("1. supported\n2. supported\n3. unsupported: x", numbers)],
      skipped: 0,
    };
    expect(reviewStepLabel(review)).toBe("Number check: 1 of 3 numbers flagged");
    expect(reviewStepLabel({ ...review, items: review.items.slice(0, 1) })).toBe(
      "Number check: 1 number found in the tool results",
    );
    expect(reviewStepLabel({ ...review, items: [] })).toBe(
      "Number check: no numbers to check",
    );
  });
});

describe("reviewItemLine", () => {
  test("shows the verdict and the matcher only when the two disagree", () => {
    expect(
      [
        { text: "80", verdict: "supported", note: null, matched: true },
        { text: "95.5", verdict: "supported", note: null, matched: false },
        { text: "81.2", verdict: "unsupported", note: "not in a row", matched: true },
        { text: "7.5", verdict: "unchecked", note: null, matched: false },
      ].map((item) => reviewItemLine(item as Parameters<typeof reviewItemLine>[0])),
    ).toEqual([
      "80: supported",
      "95.5: supported (the number links found no tool result for it)",
      "81.2: flagged: not in a row (the number links found it in a tool result)",
      "7.5: not checked",
    ]);
  });
});
