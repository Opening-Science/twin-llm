import { describe, expect, test } from "bun:test";

import {
  isAcceptable,
  isPseudonym,
  isRubricLevel,
  RUBRIC_LABELS,
  RUBRIC_LEVELS,
} from "./rater-rubric";

describe("rubric", () => {
  test("five levels, lowest first, each with a label and an anchor", () => {
    expect(RUBRIC_LEVELS.map((each) => each.level)).toEqual([1, 2, 3, 4, 5]);
    expect(RUBRIC_LABELS).toEqual([
      "Wrong or invented",
      "Not answered",
      "Partly right",
      "Right, small flaw",
      "Right and grounded",
    ]);
    expect(RUBRIC_LEVELS.every((each) => each.anchor.length > 40)).toBe(true);
  });

  test("4 and 5 are acceptable", () => {
    expect([1, 2, 3, 4, 5].map(isAcceptable)).toEqual([false, false, false, true, true]);
  });

  test("a level is a whole number from 1 to 5", () => {
    expect([0, 1, 5, 6, 2.5, "3", null].map(isRubricLevel)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  test("pseudonyms are safe file names", () => {
    expect(
      [
        "rater-b",
        "r2",
        "a",
        "Rater",
        "rater-",
        "-x",
        "../x",
        "rater b",
        "x".repeat(33),
      ].map(isPseudonym),
    ).toEqual([true, true, false, false, false, false, false, false, false]);
  });
});

describe("the doc", () => {
  test("docs/evaluation/second-rater.md states every anchor as the code does", async () => {
    const doc = await Bun.file(
      new URL("../../docs/evaluation/second-rater.md", import.meta.url),
    ).text();
    const flat = doc.replace(/\s+/g, " ");
    expect(
      RUBRIC_LEVELS.map((each) =>
        flat.includes(`| ${each.level} | ${each.label}`.replace(/\s+/g, " "))
          ? flat.includes(each.anchor)
          : "row missing",
      ),
    ).toEqual([true, true, true, true, true]);
  });
});
