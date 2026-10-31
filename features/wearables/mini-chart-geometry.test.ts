import { describe, expect, test } from "bun:test";

import { barLayout, lastItems, trendPath } from "./mini-chart-geometry";

const box = { width: 100, height: 40, pad: 0 };

describe("trendPath", () => {
  test("runs from the first to the last value across the box", () => {
    expect(trendPath([10, 20, 15], box)).toBe("M0,40 L50,0 L100,20");
  });

  test("a flat series sits in the middle", () => {
    expect(trendPath([5, 5], box)).toBe("M0,20 L100,20");
  });

  test("fewer than two values draw nothing and non-numbers are skipped", () => {
    expect(trendPath([7], box)).toBe("");
    expect(trendPath([Number.NaN, 1, 3], box)).toBe("M0,40 L100,0");
  });
});

describe("barLayout", () => {
  test("scales bars from zero to the largest value", () => {
    expect(barLayout([50, 100], box, 0)).toEqual([
      { x: 0, y: 20, width: 50, height: 20 },
      { x: 50, y: 0, width: 50, height: 40 },
    ]);
  });

  test("a missing day keeps its slot with no bar", () => {
    expect(barLayout([null, 100], box, 0)).toEqual([
      null,
      { x: 50, y: 0, width: 50, height: 40 },
    ]);
  });

  test("leaves a gap between bars and nothing for an empty list", () => {
    expect(barLayout([10, 10], box, 4)).toEqual([
      { x: 2, y: 0, width: 46, height: 40 },
      { x: 52, y: 0, width: 46, height: 40 },
    ]);
    expect(barLayout([], box)).toEqual([]);
  });
});

describe("lastItems", () => {
  test("keeps the newest items in order", () => {
    expect(lastItems([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(lastItems([1, 2], 5)).toEqual([1, 2]);
    expect(lastItems([1, 2], 0)).toEqual([]);
  });
});
