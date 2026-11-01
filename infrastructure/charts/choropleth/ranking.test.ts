import { describe, expect, test } from "bun:test";

import { mapDecimals, rankRegions, topRegions } from "./ranking";

const region = (code: string, name: string, value: number) => ({
  code,
  name,
  value,
  lower: null,
  upper: null,
});

describe("rankRegions", () => {
  test("ranks by value, highest first, ties by name", () => {
    expect(
      rankRegions([
        region("A", "Bravo", 1),
        region("B", "Alpha", 5),
        region("C", "Charlie", 5),
      ]).map((entry) => [entry.code, entry.rank]),
    ).toEqual([
      ["B", 1],
      ["C", 2],
      ["A", 3],
    ]);
  });
});

describe("topRegions", () => {
  test("keeps the first n", () => {
    expect(
      topRegions([region("A", "A", 1), region("B", "B", 2), region("C", "C", 3)], 2).map(
        (entry) => entry.code,
      ),
    ).toEqual(["C", "B"]);
  });

  test("a negative count keeps none", () => {
    expect(topRegions([region("A", "A", 1)], -1)).toEqual([]);
  });
});

describe("mapDecimals", () => {
  test("follows the median magnitude", () => {
    expect(mapDecimals([150, 900, 3])).toBe(0);
    expect(mapDecimals([12.5, 40, 0.2])).toBe(1);
    expect(mapDecimals([0.12, 3.4, 900])).toBe(2);
    expect(mapDecimals([])).toBe(0);
  });
});
