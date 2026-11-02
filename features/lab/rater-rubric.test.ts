import { describe, expect, test } from "bun:test";

import {
  isAcceptable,
  isPseudonym,
  isRatedSet,
  isRubricLevel,
  RATED_SETS,
  ratedSetOf,
  ratedSetOfRubric,
  RUBRIC_LABELS,
  RUBRIC_LEVELS,
  RUBRIC_VERSION,
  rubricLabels,
  rubricOf,
  V1H_RUBRIC_LEVELS,
  V1H_RUBRIC_VERSION,
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

describe("rated sets (#304)", () => {
  test("hb and v1h, hb by default; anything else is not a rated set", () => {
    expect(RATED_SETS).toEqual(["hb", "v1h"]);
    expect([undefined, null, "", "hb", "v1h"].map(ratedSetOf)).toEqual([
      "hb",
      "hb",
      "hb",
      "hb",
      "v1h",
    ]);
    expect(["v1", "s7h", "HB", ["v1h"], 1].map(ratedSetOf)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(["hb", "v1h", "v1", undefined].map(isRatedSet)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  test("each set has its own rubric version; hb keeps second-rater.v1", () => {
    expect(rubricOf("hb")).toEqual({ version: RUBRIC_VERSION, levels: RUBRIC_LEVELS });
    expect(RUBRIC_VERSION).toBe("second-rater.v1");
    expect(rubricOf("v1h").version).toBe(V1H_RUBRIC_VERSION);
    expect(V1H_RUBRIC_VERSION).not.toBe(RUBRIC_VERSION);
    expect(ratedSetOfRubric("second-rater.v1")).toBe("hb");
    expect(ratedSetOfRubric("second-rater.v1h.v1")).toBe("v1h");
    expect(ratedSetOfRubric("second-rater.v0")).toBeNull();
  });

  test("v1h: the same five labels, its own anchors, none about a verdict", () => {
    expect(V1H_RUBRIC_LEVELS.map((each) => each.level)).toEqual([1, 2, 3, 4, 5]);
    expect(rubricLabels(rubricOf("v1h"))).toEqual(RUBRIC_LABELS);
    expect(V1H_RUBRIC_LEVELS.every((each) => !/verdict/i.test(each.anchor))).toBe(true);
    expect(
      V1H_RUBRIC_LEVELS.map((each) => each.anchor).filter(
        (anchor, index) => anchor === RUBRIC_LEVELS[index]?.anchor,
      ),
    ).toEqual([]);
    const top = V1H_RUBRIC_LEVELS[4]?.anchor ?? "";
    expect(
      ["Data item", "Decline or refusal item", "No keyed reference"].map((kind) =>
        top.includes(kind),
      ),
    ).toEqual([true, true, true]);
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

  test("docs/evaluation/second-rater.md states every v1h anchor as the code does", async () => {
    const doc = await Bun.file(
      new URL("../../docs/evaluation/second-rater.md", import.meta.url),
    ).text();
    const flat = doc.replace(/\s+/g, " ");
    expect(V1H_RUBRIC_LEVELS.map((each) => flat.includes(each.anchor))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
