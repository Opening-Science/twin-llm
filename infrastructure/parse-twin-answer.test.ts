import { describe, expect, test } from "bun:test";

import {
  parseTwinAnswer,
  sectionSpans,
  type WearableSummaries,
} from "./parse-twin-answer";

const noWearables: WearableSummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

const WINDOW = { startDate: "2026-01-01", endDate: "2026-01-02" };

const syntheticOura: WearableSummaries = {
  oura: {
    window: WINDOW,
    narrative: "Synthetic Oura window.",
    metrics: [{ key: "oura.sleep.score.2026-01-01", label: "Sleep score", value: 82 }],
  },
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

const sections = (text: string) => {
  const parsed = parseTwinAnswer(text, noWearables);
  return {
    reasoning: parsed.reasoningText,
    answer: parsed.answerText,
    uncertainty: parsed.uncertaintyText,
    cited: parsed.citedKeys,
  };
};

describe("tolerant section headings", () => {
  test("### headings work like ##", () => {
    expect(
      sections(
        "### Reasoning\nR.\n### Evidence Used\n- none\n### Answer\nA.\n### Uncertainty\nU.",
      ),
    ).toEqual({ reasoning: "R.", answer: "A.", uncertainty: "U.", cited: ["none"] });
  });

  test("bold headings in all three colon forms", () => {
    expect(
      sections(
        "**Reasoning**\nR.\n**Evidence Used:**\n- none\n**Answer**:\nA.\n**Uncertainty**\nU.",
      ),
    ).toEqual({ reasoning: "R.", answer: "A.", uncertainty: "U.", cited: ["none"] });
  });

  test("aliases map onto the four sections", () => {
    for (const label of ["Summary", "Final answer", "Response"]) {
      expect(
        parseTwinAnswer(`## ${label}\nSynthetic body.`, noWearables).answerText,
      ).toBe("Synthetic body.");
    }
    expect(
      parseTwinAnswer("## Limitations\nSynthetic caveat.", noWearables).uncertaintyText,
    ).toBe("Synthetic caveat.");
    expect(parseTwinAnswer("## Evidence\n- none", noWearables).citedKeys).toEqual([
      "none",
    ]);
  });

  test("labels are case-insensitive and a trailing colon is dropped", () => {
    expect(sections("## REASONING:\nR.\n## final ANSWER\nA.")).toEqual({
      reasoning: "R.",
      answer: "A.",
      uncertainty: null,
      cited: [],
    });
  });

  test("an unknown subheading stays inside the answer", () => {
    expect(
      parseTwinAnswer(
        "## Answer\nIntro.\n\n### Details\nMore.\n\n## Uncertainty\nU.",
        noWearables,
      ).answerText,
    ).toBe("Intro.\n\n### Details\nMore.");
  });

  test("bold text inside a line is not a heading", () => {
    expect(
      parseTwinAnswer(
        "## Answer\nThe **Summary** below is short.\n**Note** the gap.",
        noWearables,
      ).answerText,
    ).toBe("The **Summary** below is short.\n**Note** the gap.");
  });

  test("no recognised heading: the whole text is the answer", () => {
    expect(sections("Plain synthetic reply.")).toEqual({
      reasoning: null,
      answer: "Plain synthetic reply.",
      uncertainty: null,
      cited: [],
    });
  });

  test("sectionSpans: offsets, ends and whether the start was canonical", () => {
    expect(sectionSpans("## Reasoning\nR.\n**Answer**\nA")).toEqual({
      reasoning: { start: 0, bodyStart: 13, end: 16, canonical: true },
      answer: { start: 16, bodyStart: 27, end: 28, canonical: false },
    });
    expect(sectionSpans("R.\n## Answer")).toEqual({
      answer: { start: 3, bodyStart: 12, end: 12, canonical: true },
    });
  });
});

describe("section ends", () => {
  test("any heading ends Evidence Used: a ## Notes block cites nothing", () => {
    const parsed = parseTwinAnswer(
      "## Evidence Used\n- [sleep.score]\n## Notes\n- hrv.rmssd noted\n## Answer\nSynthetic.",
      noWearables,
    );
    expect(parsed.citedKeys).toEqual(["sleep.score"]);
    expect(parsed.answerText).toBe("Synthetic.");
  });

  test("any heading ends Reasoning and Uncertainty, bold or hashed", () => {
    expect(
      sections(
        "## Reasoning\nR.\n**Step two**\nmore\n## Answer\nA.\n## Uncertainty\nU.\n### Footnote\nF.",
      ),
    ).toEqual({ reasoning: "R.", answer: "A.", uncertainty: "U.", cited: [] });
  });
});

describe("canonical headings win over aliases", () => {
  test("**Summary** inside Reasoning does not become the Answer", () => {
    expect(
      sections("## Reasoning\nR.\n**Summary**\nS.\n## Answer\nA.\n## Uncertainty\nU."),
    ).toEqual({ reasoning: "R.", answer: "A.", uncertainty: "U.", cited: [] });
  });

  test("**Evidence:** inside Reasoning does not replace ## Evidence Used", () => {
    const parsed = parseTwinAnswer(
      [
        "## Reasoning",
        "R.",
        "**Evidence:**",
        "- [made.up.key]",
        "## Evidence Used",
        "- [sleep.score]",
        "## Answer",
        "A.",
      ].join("\n"),
      noWearables,
    );
    expect(parsed.citedKeys).toEqual(["sleep.score"]);
    expect(parsed.reasoningText).toBe("R.");
  });

  test("### Limitations inside the Answer does not cut it", () => {
    expect(
      sections(
        "## Reasoning\nR.\n## Answer\nA.\n\n### Limitations\nL.\n## Uncertainty\nU.",
      ),
    ).toEqual({
      reasoning: "R.",
      answer: "A.\n\n### Limitations\nL.",
      uncertainty: "U.",
      cited: [],
    });
  });

  test("an alias still starts a section that has no canonical heading", () => {
    expect(sections("## Reasoning\nR.\n## Answer\nA.\n**Limitations:**\nL.")).toEqual({
      reasoning: "R.",
      answer: "A.",
      uncertainty: "L.",
      cited: [],
    });
  });
});

/** Replies shaped like qwen3:4b output (A2 manual check); the content is synthetic. */
describe("qwen3-style goldens", () => {
  test("bold labels with Summary for the answer", () => {
    const text = [
      "**Reasoning:**",
      "The synthetic sleep score is the only metric offered.",
      "",
      "**Evidence Used:**",
      "- [oura.sleep.score.2026-01-01]",
      "",
      "**Summary:**",
      "Your synthetic sleep score sits in the usual range for this window.",
      "",
      "**Uncertainty:**",
      "One night of synthetic data says little about a trend.",
    ].join("\n");
    const parsed = parseTwinAnswer(text, syntheticOura);
    expect(parsed.reasoningText).toBe(
      "The synthetic sleep score is the only metric offered.",
    );
    expect(parsed.answerText).toBe(
      "Your synthetic sleep score sits in the usual range for this window.",
    );
    expect(parsed.uncertaintyText).toBe(
      "One night of synthetic data says little about a trend.",
    );
    expect(parsed.citedKeys).toEqual(["oura.sleep.score.2026-01-01"]);
    expect(parsed.evidenceKeys).toEqual(["oura.sleep.score.2026-01-01"]);
    expect(parsed.hallucinatedKeys).toEqual([]);
  });

  test("### Final answer with Limitations and a table in the answer", () => {
    const text = [
      "### Reasoning",
      "Compare the two synthetic windows.",
      "",
      "### Evidence Used",
      "- none",
      "",
      "### Final answer",
      "| Window | Steps |",
      "|---|---|",
      "| A | 8,000 |",
      "",
      "### Limitations",
      "Synthetic cohort only.",
    ].join("\n");
    const parsed = parseTwinAnswer(text, noWearables);
    expect(parsed.reasoningText).toBe("Compare the two synthetic windows.");
    expect(parsed.answerText).toBe("| Window | Steps |\n|---|---|\n| A | 8,000 |");
    expect(parsed.uncertaintyText).toBe("Synthetic cohort only.");
    expect(parsed.citedKeys).toEqual(["none"]);
    expect(parsed.evidenceKeys).toEqual([]);
  });

  test("## Evidence with an invented key next to an offered one", () => {
    const text = [
      "## Reasoning",
      "Synthetic reasoning.",
      "",
      "## Evidence",
      "- [oura.sleep.score.2026-01-01] sleep score",
      "- [oura.made.up.key]",
      "",
      "## Answer",
      "Synthetic answer.",
    ].join("\n");
    const parsed = parseTwinAnswer(text, syntheticOura);
    expect(parsed.citedKeys).toEqual(["oura.sleep.score.2026-01-01", "oura.made.up.key"]);
    expect(parsed.evidenceKeys).toEqual(["oura.sleep.score.2026-01-01"]);
    expect(parsed.hallucinatedKeys).toEqual(["oura.made.up.key"]);
    expect(parsed.answerText).toBe("Synthetic answer.");
    expect(parsed.uncertaintyText).toBeNull();
  });
});

describe("inline labels", () => {
  test("Q-S3-07 shape: each label with its text on the same line", () => {
    const text = [
      "Reasoning: The synthetic cohort shows one HbA1c reading per year for this subject.",
      "Evidence Used: - none",
      "Answer: HbA1c stayed near 5.6 % across the synthetic record.",
      "Uncertainty: Three readings are too few to call a trend.",
    ].join("\n");
    expect(sections(text)).toEqual({
      reasoning:
        "The synthetic cohort shows one HbA1c reading per year for this subject.",
      answer: "HbA1c stayed near 5.6 % across the synthetic record.",
      uncertainty: "Three readings are too few to call a trend.",
      cited: ["none"],
    });
  });

  test("Q-S5-08 shape: labels alone on their lines, bodies below", () => {
    const text = [
      "Reasoning:",
      "The synthetic sleep score is the only metric offered.",
      "",
      "evidence used:",
      "[oura.sleep.score.2026-01-01] [oura.made.up.2026-01-01]",
      "",
      "ANSWER:",
      "Your synthetic sleep score sits in the usual range.",
      "Next step: compare it with next week.",
      "",
      "Uncertainty:",
      "One synthetic night says little about a trend.",
    ].join("\n");
    const parsed = parseTwinAnswer(text, syntheticOura);
    expect(parsed.reasoningText).toBe(
      "The synthetic sleep score is the only metric offered.",
    );
    expect(parsed.answerText).toBe(
      "Your synthetic sleep score sits in the usual range.\nNext step: compare it with next week.",
    );
    expect(parsed.uncertaintyText).toBe("One synthetic night says little about a trend.");
    expect(parsed.evidenceKeys).toEqual(["oura.sleep.score.2026-01-01"]);
    expect(parsed.hallucinatedKeys).toEqual(["oura.made.up.2026-01-01"]);
  });

  test("bold and italic inline labels, closing before or after the colon", () => {
    const text = [
      "**Reasoning:** Synthetic reasoning.",
      "**Evidence Used**: - none",
      "**Answer:** Synthetic answer.",
      "_Uncertainty:_ Synthetic caveat.",
    ].join("\n");
    expect(sections(text)).toEqual({
      reasoning: "Synthetic reasoning.",
      answer: "Synthetic answer.",
      uncertainty: "Synthetic caveat.",
      cited: ["none"],
    });
  });

  test("a label mid-line, without a colon, or not one of the four is prose", () => {
    const text = [
      "Reasoning: The answer: yes, the synthetic score rose.",
      "Answer the question first, then explain.",
      "Summary: not a section name inline.",
      "Uncertainty: Synthetic caveat.",
    ].join("\n");
    expect(sections(text)).toEqual({
      reasoning:
        "The answer: yes, the synthetic score rose.\nAnswer the question first, then explain.\nSummary: not a section name inline.",
      answer: text,
      uncertainty: "Synthetic caveat.",
      cited: [],
    });
  });

  test("a bold label with bold later on the line is a label, not a bold heading", () => {
    const text = [
      "Reasoning: Synthetic reasoning.",
      "**Answer:** The **key** point is **sleep**",
    ].join("\n");
    expect(sections(text).answer).toBe("The **key** point is **sleep**");
  });

  test("mismatched emphasis leaves no stray star in the body", () => {
    const text = "Reasoning: Synthetic.\n**Answer:* Synthetic answer.";
    expect(sections(text).answer).toBe("Synthetic answer.");
  });

  test("a lone Answer: line in prose is prose, as on main", () => {
    const text = "The synthetic score rose.\nAnswer: yes, it rose over the window.";
    expect(sections(text)).toEqual({
      reasoning: null,
      answer: text,
      uncertainty: null,
      cited: [],
    });
  });

  test("with a bold or alias heading, inline labels are prose, as on main", () => {
    const text = [
      "**Reasoning**",
      "Synthetic reasoning.",
      "Answer: it depends on the synthetic rows.",
      "Uncertainty: some.",
      "",
      "**Summary**",
      "Real summary.",
    ].join("\n");
    expect(sections(text)).toEqual({
      reasoning:
        "Synthetic reasoning.\nAnswer: it depends on the synthetic rows.\nUncertainty: some.",
      answer: "Real summary.",
      uncertainty: null,
      cited: [],
    });
  });

  test("with a canonical heading anywhere, inline labels are prose", () => {
    const text = [
      "## Reasoning",
      "Answer: maybe, but check the synthetic rows first.",
      "Uncertainty: noted below.",
      "",
      "## Answer",
      "Synthetic answer.",
    ].join("\n");
    expect(sections(text)).toEqual({
      reasoning:
        "Answer: maybe, but check the synthetic rows first.\nUncertainty: noted below.",
      answer: "Synthetic answer.",
      uncertainty: null,
      cited: [],
    });
  });
});

describe("thinking leaked past think: false", () => {
  const LEAKED = [
    "Okay, let's see. The user wants the latest heart rate. I should call latest_by_loinc.",
    "</think>",
    "",
    "## Reasoning",
    "The latest reading is from 2021.",
    "",
    "## Answer",
    "72 /min on 3 March 2021.",
  ].join("\n");

  test("the answer and reasoning come from after the closing tag", () => {
    const parsed = parseTwinAnswer(LEAKED, null);
    expect(parsed.answerText).toBe("72 /min on 3 March 2021.");
    expect(parsed.reasoningText).toBe("The latest reading is from 2021.");
  });

  test("with no Reasoning section the thinking stands in for it", () => {
    const parsed = parseTwinAnswer(
      "<think>check the window first</think>\n72 /min",
      null,
    );
    expect(parsed.answerText).toBe("72 /min");
    expect(parsed.reasoningText).toBe("check the window first");
  });
});

describe("a section that repeats the prompt's guidance", () => {
  test("the copied line is dropped; an Answer of only that line is empty", () => {
    const parsed = parseTwinAnswer(
      [
        "## Reasoning",
        "Step-by-step chain of thought. Be concise but explicit about assumptions.",
        "",
        "I read the trend.",
        "",
        "## Answer",
        "The user-facing answer in plain language. Do not invent wearable numbers.",
      ].join("\n"),
      null,
    );
    expect(parsed.reasoningText).toBe("I read the trend.");
    expect(parsed.answerText).toBe("");
  });
});
