import { describe, expect, test } from "bun:test";

import {
  finishedAnswer,
  isWithheld,
  mayBecomeHeading,
  silentAnswerLine,
  stoppedAnswerText,
  streamingView,
} from "./answer-text";

const FULL = [
  "## Reasoning",
  "Read the rows.",
  "",
  "## Evidence Used",
  "- synthetic.heart_rate",
  "",
  "## Answer",
  "Heart rate fell from 78 to 72.5 bpm.",
  "",
  "## Uncertainty",
  "Few readings.",
].join("\n");

describe("a streaming column (SPEC 2.4)", () => {
  test("nothing written yet waits", () => {
    expect(streamingView("")).toEqual({ kind: "waiting" });
    expect(streamingView("   ")).toEqual({ kind: "waiting" });
  });

  test("scaffolding before the Answer section is never shown", () => {
    expect(streamingView("## Reasoning\nRead the rows.\n")).toEqual({
      kind: "preparing",
    });
    expect(streamingView("## Reasoning\nRead.\n\n## Evidence Used\n- none\n")).toEqual({
      kind: "preparing",
    });
  });

  test("a leaked thinking block is removed before anything else", () => {
    expect(streamingView("<think>Let me see what 78 means")).toEqual({ kind: "waiting" });
    expect(streamingView("Hmm, numbers.</think>\n## Answer\nIt fell.")).toEqual({
      kind: "answer",
      text: "It fell.",
    });
  });

  test("once the Answer starts, only its text so far shows", () => {
    expect(streamingView("## Reasoning\nRead.\n\n## Answer\nHeart rate fell")).toEqual({
      kind: "answer",
      text: "Heart rate fell",
    });
  });

  test("a last line that may become a heading is held back", () => {
    expect(streamingView("## Answer\nIt fell.\n\n#")).toEqual({
      kind: "answer",
      text: "It fell.",
    });
    expect(streamingView("## Answer\nIt fell.\nUnc")).toEqual({
      kind: "answer",
      text: "It fell.",
    });
    expect(streamingView("## Answer\nIt fell.\n_Uncertainty")).toEqual({
      kind: "answer",
      text: "It fell.",
    });
  });

  test("text after the Uncertainty heading stays at the Answer's end", () => {
    expect(streamingView(FULL)).toEqual({
      kind: "answer",
      text: "Heart rate fell from 78 to 72.5 bpm.",
    });
  });

  test("with canonical headings a bold Summary in the reasoning does not start the Answer", () => {
    const text = "## Reasoning\nFirst.\n**Summary**\nNot yet the answer.\n";
    expect(streamingView(text)).toEqual({ kind: "preparing" });
  });

  test("a bold alias starts the Answer when the reply has no canonical headings", () => {
    expect(streamingView("**Reasoning**\nRead.\n**Summary**\nIt fell.")).toEqual({
      kind: "answer",
      text: "It fell.",
    });
  });

  test("inline labels start the Answer like headings", () => {
    expect(streamingView("Reasoning: read the rows.\nAnswer: it fell.")).toEqual({
      kind: "answer",
      text: "it fell.",
    });
  });

  test("a reply with no headings keeps the status line", () => {
    expect(streamingView("Heart rate fell over spring.")).toEqual({ kind: "preparing" });
  });

  test("the decline marker is never shown", () => {
    expect(streamingView("REF")).toEqual({ kind: "preparing" });
    expect(streamingView("REFUSE: I can't advise on doses.")).toEqual({
      kind: "preparing",
    });
    expect(streamingView("**REFUSE:** no.")).toEqual({ kind: "preparing" });
  });

  test("which lines may become headings", () => {
    expect(mayBecomeHeading("## Ans")).toBe(true);
    expect(mayBecomeHeading("**Ans")).toBe(true);
    expect(mayBecomeHeading("Uncertainty:")).toBe(true);
    expect(mayBecomeHeading("evidence us")).toBe(true);
    expect(mayBecomeHeading("Heart rate")).toBe(false);
    expect(mayBecomeHeading("")).toBe(false);
  });
});

describe("a finished or stopped column (SPEC 2.5, 2.7)", () => {
  test("a structured reply shows its Answer section", () => {
    expect(finishedAnswer(FULL)).toEqual({
      answer: "Heart rate fell from 78 to 72.5 bpm.",
      uncertainty: "Few readings.",
    });
  });

  test("a reply without sections shows whole, less any thinking block", () => {
    expect(finishedAnswer("Thinking.</think>\nIt fell a little.").answer).toBe(
      "It fell a little.",
    );
  });

  test("a stopped answer keeps only what was written into the Answer section", () => {
    expect(stoppedAnswerText("## Reasoning\nRead the rows")).toBe("");
    expect(stoppedAnswerText("## Reasoning\nRead.\n## Answer\nIt fell to 72")).toBe(
      "It fell to 72",
    );
  });
});

describe("withheld and silent answers (SPEC 2.5)", () => {
  test("an abstained or declined document withholds the answer", () => {
    expect(isWithheld(null)).toBe(false);
    expect(isWithheld({ abstained: false, answer_class: "information" })).toBe(false);
    expect(isWithheld({ abstained: true, answer_class: "information" })).toBe(true);
    expect(
      isWithheld({ abstained: false, answer_class: "declined_decision_support" }),
    ).toBe(true);
  });

  test("the silent line agrees with the number of lookups", () => {
    expect(silentAnswerLine(0)).toBe("This model wrote no answer.");
    expect(silentAnswerLine(1)).toContain("ran 1 lookup and");
    expect(silentAnswerLine(1)).toContain("The step above shows what it returned.");
    expect(silentAnswerLine(3)).toContain("ran 3 lookups and");
    expect(silentAnswerLine(3)).toContain("The steps above show what they returned.");
  });
});
