import { describe, expect, test } from "bun:test";

import { inlineLabel, sectionLines, TWIN_HEADINGS } from "./twin-section-lines";

describe("inlineLabel", () => {
  test("reads each of the four names before a colon, in any case", () => {
    expect(inlineLabel("Answer: yes")).toEqual({ heading: "Answer", length: 8 });
    expect(inlineLabel("evidence used: rows")?.heading).toBe("Evidence Used");
    expect(inlineLabel("EVIDENCE   USED: rows")?.heading).toBe("Evidence Used");
    expect(inlineLabel("Reasoning:")?.heading).toBe("Reasoning");
    expect(inlineLabel("Uncertainty:\tsome")).toEqual({
      heading: "Uncertainty",
      length: 13,
    });
  });

  test("takes the emphasis round the name, before or after the colon", () => {
    expect(inlineLabel("**Answer:** yes")).toEqual({ heading: "Answer", length: 12 });
    expect(inlineLabel("**Answer**: yes")).toEqual({ heading: "Answer", length: 12 });
    expect(inlineLabel("_Uncertainty:_ low")).toEqual({
      heading: "Uncertainty",
      length: 15,
    });
  });

  test("closes a label opened but not closed before the colon, so no * reaches the body", () => {
    const line = "**Answer:* x";
    const found = inlineLabel(line);
    expect(found?.heading).toBe("Answer");
    expect(line.slice(found?.length ?? 0)).toBe("x");
  });

  test("is prose without a colon, after a list mark or a quote, or for another word", () => {
    expect(inlineLabel("Answer the question")).toBeNull();
    expect(inlineLabel("- Answer: yes")).toBeNull();
    expect(inlineLabel("> Answer: yes")).toBeNull();
    expect(inlineLabel("Summary: yes")).toBeNull();
    expect(inlineLabel("")).toBeNull();
  });
});

describe("sectionLines", () => {
  test("finds the four canonical headings with their offsets", () => {
    const text = TWIN_HEADINGS.map((heading) => `## ${heading}\nbody`).join("\n");
    const lines = sectionLines(text);
    expect(
      lines.map((line) => (line.kind === "heading" ? line.canonical : null)),
    ).toEqual([...TWIN_HEADINGS]);
    const [first] = lines;
    expect(first).toEqual({
      kind: "heading",
      start: 0,
      end: "## Reasoning".length,
      label: "Reasoning",
      canonical: "Reasoning",
    });
    expect(text.slice(lines[2]?.start, lines[2]?.end)).toBe("## Answer");
  });

  test("keeps other headings, bold lines included, without a canonical name", () => {
    const lines = sectionLines("# Summary\ntext\n**Notes**\nmore");
    expect(lines).toEqual([
      { kind: "heading", start: 0, end: 9, label: "Summary", canonical: null },
      { kind: "heading", start: 15, end: 24, label: "Notes", canonical: null },
    ]);
  });

  test("a bold label with text after it is a label, not a bold heading", () => {
    const text = "**Answer:** The **key** point\n**Uncertainty:** some";
    expect(sectionLines(text).map((line) => line.kind)).toEqual(["inline", "inline"]);
  });

  test("uses inline labels only with no heading line and two different names", () => {
    const text = "Reasoning: because\n  Answer: yes";
    expect(sectionLines(text)).toEqual([
      { kind: "inline", start: 0, end: 18, heading: "Reasoning", bodyStart: 11 },
      { kind: "inline", start: 19, end: 32, heading: "Answer", bodyStart: 29 },
    ]);
    expect(text.slice(29)).toBe("yes");
  });

  test("a lone label, a repeated one, or a label beside a heading stays prose", () => {
    expect(sectionLines("Answer: yes")).toEqual([]);
    expect(sectionLines("Answer: yes\nAnswer: still")).toEqual([]);
    expect(
      sectionLines("**Summary**\nAnswer: yes\nReasoning: so").map((l) => l.kind),
    ).toEqual(["heading"]);
  });
});
