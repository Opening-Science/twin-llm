import { describe, expect, test } from "bun:test";

import { nextIndex, progressText, ratedCount, resumeIndex } from "./rater-progress";

const levels = (...values: (number | null)[]) => values.map((level) => ({ level }));

describe("rater progress", () => {
  test("resumes at the first unrated line, else the last", () => {
    expect(resumeIndex(levels(3, null, null))).toBe(1);
    expect(resumeIndex(levels(3, 4))).toBe(1);
    expect(resumeIndex([])).toBe(0);
  });

  test("goes to the next unrated line, wrapping to an earlier one", () => {
    expect(nextIndex(levels(3, 4, null, 2, null), 1)).toBe(2);
    expect(nextIndex(levels(null, 4, 5), 2)).toBe(0);
    expect(nextIndex(levels(1, 4, 5), 0)).toBe(1);
    expect(nextIndex(levels(1, 4, 5), 2)).toBe(2);
  });

  test("counts and words", () => {
    expect(ratedCount(levels(1, null, 5))).toBe(2);
    expect(progressText(levels(1, null, 5), 1)).toBe("Answer 2 of 3 · 2 rated");
  });
});
