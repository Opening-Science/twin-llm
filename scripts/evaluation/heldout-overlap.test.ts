import { describe, expect, test } from "bun:test";

import {
  conversationUserTurns,
  isWordingRun,
  normaliseText,
  overlaps,
  overlapWithTurns,
  runsOf,
  sharedRun,
  wordsOf,
} from "./heldout-overlap";

describe("normaliseText", () => {
  test("values and placeholders become the same class words", () => {
    expect(
      normaliseText(
        "How did HbA1c (LOINC 4548-4) change for subject 9661a432-4630-2cd9-142c-386845fae837 between 2024-01-01 and 3 Aug 2026?",
      ),
    ).toBe(
      normaliseText(
        "How did HbA1c (LOINC {code}) change for subject {ref} between {start} and {end}?",
      ),
    );
    expect(normaliseText("Fit a line over 2019 to 2023, 12.5 days")).toBe(
      "fit a line over date to date n days",
    );
    expect(normaliseText("{label} for subject s-1")).toBe("x for subject ref");
    expect(normaliseText("Deaths in the United Kingdom")).toBe("deaths in the x");
  });
});

describe("runs", () => {
  test("every run of the given length, in order", () => {
    expect([...runsOf(["a", "b", "c", "d", "e"], 4)]).toEqual(["a b c d", "b c d e"]);
    expect(runsOf(["a", "b"], 3).size).toBe(0);
  });

  test("a run of mostly class words is not a shared phrase", () => {
    expect(isWordingRun("subject ref from date to date")).toBe(false);
    expect(isWordingRun("against its own date to date")).toBe(true);
    expect(
      sharedRun("for subject {ref} from {y0} to {y1}", "subject abc-1 from 2020 to 2021"),
    ).toBe(null);
  });

  test("a shared run is found across punctuation and case", () => {
    expect(
      sharedRun(
        "Which value was recorded LAST for subject {ref}, please?",
        "the value was recorded last for subject abc-1",
        6,
      ),
    ).toBe("value was recorded last for subject");
    expect(sharedRun("one two three four", "five six seven eight", 4)).toBe(null);
    expect(wordsOf("A, b.")).toEqual(["a", "b"]);
  });
});

describe("overlaps", () => {
  test("names equal skeletons and shared runs, and passes distinct wording", () => {
    const found = overlaps(
      [
        { id: "h1", text: "Show {label} for subject {ref} in {y}." },
        { id: "h2", text: "Tell me the very same old words again here." },
        { id: "h3", text: "Entirely fresh wording about something else." },
      ],
      [
        { id: "t1", text: "show {label} for subject {ref} in {period}" },
        { id: "t2", text: "she said the very same old words again yesterday" },
      ],
      5,
    );
    expect(found).toEqual([
      { id: "h1", other: "t1", why: "skeleton" },
      { id: "h2", other: "t2", why: "the very same old words" },
    ]);
  });
});

describe("conversationUserTurns", () => {
  test("reads user turns only and skips lines that do not parse", () => {
    const jsonl = [
      JSON.stringify({
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "first question" },
          { role: "assistant", content: null },
          { role: "user", content: "second question" },
        ],
      }),
      "not json",
      JSON.stringify({ other: true }),
      "",
    ].join("\n");
    expect(conversationUserTurns(jsonl)).toEqual(["first question", "second question"]);
  });

  test("overlapWithTurns lists each overlapping item once", () => {
    expect(
      overlapWithTurns(
        [
          {
            id: "Q-1",
            text: "How did the platelet count of subject {ref} change over the years?",
          },
          { id: "Q-2", text: "Something unrelated entirely." },
        ],
        [
          "how did the platelet count of subject abc-1 change over time",
          "the platelet count of subject abc-2 change over",
        ],
      ),
    ).toEqual(["Q-1"]);
  });
});
