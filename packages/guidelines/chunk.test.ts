import { describe, expect, test } from "bun:test";

import { chunkGuidelineText } from "./chunk";

const MARKED = [
  "# Section: Non-invasive ventilation",
  "# Rec: R3",
  "# Class: Strong",
  "# Evidence: moderate",
  "# Page: 12",
  "",
  "Use NIV when the published section names it.",
  "",
  "# Section: Nutrition",
  "# Rec: R7",
  "# Class: Weak",
  "# Evidence: low",
  "",
  "Nutrition notes stay with the heading.",
].join("\n");

describe("guideline chunking", () => {
  test("keeps rec id, class, evidence level, and heading on each chunk", () => {
    const chunks = chunkGuidelineText(MARKED);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      sectionHeading: "Non-invasive ventilation",
      recommendationId: "R3",
      recClass: "Strong",
      evidenceLevel: "moderate",
      page: "12",
    });
    expect(chunks[0]?.text).toContain("Non-invasive ventilation");
    expect(chunks[0]?.text).toContain("Rec R3");
    expect(chunks[0]?.text).toContain("Class Strong");
    expect(chunks[0]?.text).toContain("Evidence moderate");
    expect(chunks[0]?.text).toContain("Use NIV when the published section names it.");
    expect(chunks[1]).toMatchObject({
      sectionHeading: "Nutrition",
      recommendationId: "R7",
      recClass: "Weak",
      evidenceLevel: "low",
    });
  });

  test("markdown headings keep Rec and Class lines", () => {
    const chunks = chunkGuidelineText(
      [
        "## Sleepiness",
        "Rec: PICO-1",
        "Class: Strong",
        "GRADE high",
        "Scheduled naps.",
      ].join("\n"),
    );
    expect(chunks[0]).toMatchObject({
      sectionHeading: "Sleepiness",
      recommendationId: "PICO-1",
      recClass: "Strong",
      evidenceLevel: "high",
    });
  });
});
