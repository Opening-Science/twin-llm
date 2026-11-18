import { describe, expect, test } from "bun:test";

import { chipSend, MAX_CHIPS, parseSuggestions } from "./suggestion-send";

const CHIP = {
  label: "How has their heart rate changed?",
  prompt:
    "For synthetic subject 29bbf012-0000-4000-8000-000000000001, using LOINC 8867-4, how has their heart rate changed?",
};

describe("a suggested question sent (SPEC 7.6)", () => {
  test("unchanged: the grounded prompt goes, the bubble shows the short text", () => {
    expect(chipSend(CHIP.label, CHIP)).toEqual({
      prompt: CHIP.prompt,
      label: CHIP.label,
    });
  });

  test("with text added after it: the grounded prompt plus the added text", () => {
    const typed = `${CHIP.label} Since January?`;
    expect(chipSend(typed, CHIP)).toEqual({
      prompt: `${CHIP.prompt} Since January?`,
      label: typed,
    });
  });

  test("any other edit sends what was typed", () => {
    expect(chipSend("How has their weight changed?", CHIP)).toEqual({
      prompt: "How has their weight changed?",
      label: null,
    });
    expect(chipSend("  plain question ", null)).toEqual({
      prompt: "plain question",
      label: null,
    });
  });
});

describe("the server's chips", () => {
  test("at most five, each with a label and a prompt", () => {
    const questions = Array.from({ length: 7 }, (_, index) => ({
      label: `Question ${String(index)}`,
      prompt: `Prompt ${String(index)}`,
    }));
    const parsed = parseSuggestions({
      heading: "From Synthetic person 1, synthetic",
      questions: [...questions, { label: "", prompt: "x" }],
    });
    expect(parsed?.questions.length).toBe(MAX_CHIPS);
    expect(parsed?.heading).toBe("From Synthetic person 1, synthetic");
  });

  test("anything else reads as no chips", () => {
    expect(parseSuggestions(null)).toBeNull();
    expect(parseSuggestions({ heading: 1, questions: [] })).toBeNull();
    expect(parseSuggestions({ heading: "", questions: [] })).toEqual({
      heading: "",
      questions: [],
    });
  });
});
