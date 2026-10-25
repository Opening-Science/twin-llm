import { describe, expect, test } from "bun:test";

import { classifyCompletion, headingOrder, TWIN_HEADINGS } from "./classify-completion";

const FOUR_HEADINGS = [
  "## Reasoning",
  "Synthetic reasoning.",
  "",
  "## Evidence Used",
  "- none",
  "",
  "## Answer",
  "Synthetic answer.",
  "",
  "## Uncertainty",
  "Synthetic uncertainty.",
].join("\n");

describe("classifyCompletion", () => {
  test.each([
    ["REFUSE: I cannot pick a dose.", "REFUSE"],
    ["REFUSE\n\nI cannot give a dose.", "REFUSE"],
    ["  \nREFUSE: leading blank lines are trimmed.", "REFUSE"],
    ["REFUSE", "REFUSE"],
    ["**REFUSE:** I cannot pick a dose.", "REFUSE"],
    ["**REFUSE**: I cannot pick a dose.", "REFUSE"],
    ["\n**REFUSE**\n\nI cannot pick a dose.", "REFUSE"],
    ["_REFUSE_: I cannot pick a dose.", "REFUSE"],
    ["_REFUSE: I cannot pick a dose.", "REFUSE"],
    ["**ABSTAIN**: not in Available keys.", "ABSTAIN"],
    ["**REFUSED** to answer.", "UNSTRUCTURED"],
    ["*REFUSE: a single star is not the marker.", "UNSTRUCTURED"],
    ["***REFUSE***: three stars is not the marker.", "UNSTRUCTURED"],
    ["REFUSED to answer.", "UNSTRUCTURED"],
    ["refuse: lower case is not the marker.", "UNSTRUCTURED"],
    ["ABSTAIN\n\nThat metric is not in Available keys.", "ABSTAIN"],
    [FOUR_HEADINGS, "ANSWER"],
    [`REFUSE: declined.\n\n${FOUR_HEADINGS}`, "REFUSE"],
    ["Plain prose with no headings.", "UNSTRUCTURED"],
  ] as const)("%j is %s", (text, expected) => {
    expect(classifyCompletion(text)).toBe(expected);
  });

  test("inline labels: four in order are an answer, as the parser reads them", () => {
    const inline = [
      "Reasoning: Synthetic reasoning.",
      "**Evidence Used:** - none",
      "answer: Synthetic answer.",
      "_Uncertainty_: Synthetic uncertainty.",
    ].join("\n");
    expect(headingOrder(inline)).toEqual([...TWIN_HEADINGS]);
    expect(classifyCompletion(inline)).toBe("ANSWER");
    expect(classifyCompletion(inline.replace("answer: ", "The answer: "))).toBe(
      "UNSTRUCTURED",
    );
  });

  test("a canonical heading anywhere: inline labels do not count", () => {
    const mixed = `## Reasoning\nSynthetic.\nEvidence Used: - none\nAnswer: x\nUncertainty: y`;
    expect(headingOrder(mixed)).toEqual(["Reasoning"]);
    expect(classifyCompletion(mixed)).toBe("UNSTRUCTURED");
  });

  test("parser and classifier agree on the label rules", () => {
    const boldLater = [
      "Reasoning: Synthetic reasoning.",
      "Evidence Used: - none",
      "**Answer:** The **key** point is **sleep**",
      "Uncertainty: Synthetic uncertainty.",
    ].join("\n");
    expect(classifyCompletion(boldLater)).toBe("ANSWER");
    expect(headingOrder(`**Note**\n${boldLater}`)).toEqual([]);
    expect(classifyCompletion(`**Note**\n${boldLater}`)).toBe("UNSTRUCTURED");
    expect(headingOrder("Prose first.\nAnswer: yes.")).toEqual([]);
  });

  test("## headings are read case-insensitively, as the parser reads them", () => {
    expect(classifyCompletion(FOUR_HEADINGS.replace("## Answer", "## answer"))).toBe(
      "ANSWER",
    );
  });

  test("headings out of order are not an answer", () => {
    const swapped = FOUR_HEADINGS.replace("## Reasoning", "## Tmp")
      .replace("## Answer", "## Reasoning")
      .replace("## Tmp", "## Answer");
    expect(headingOrder(swapped)).toEqual([
      "Answer",
      "Evidence Used",
      "Reasoning",
      "Uncertainty",
    ]);
    expect(classifyCompletion(swapped)).toBe("UNSTRUCTURED");
    expect(headingOrder(FOUR_HEADINGS)).toEqual([...TWIN_HEADINGS]);
  });
});
