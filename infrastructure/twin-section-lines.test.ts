import { describe, expect, test } from "bun:test";

import { inlineLabel } from "./twin-section-lines";

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
