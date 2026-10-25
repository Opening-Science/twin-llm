import { describe, expect, test } from "bun:test";

import {
  countTicks,
  extent,
  labelIndexes,
  nearestIndex,
  niceTicks,
  tickDecimals,
  tooltipPosition,
  truncateLabel,
  yearTickTimes,
} from "./chart-geometry";

describe("ticks", () => {
  test("round steps that cover the range", () => {
    expect(niceTicks(62, 97)).toEqual([60, 70, 80, 90, 100]);
    expect(niceTicks(1.003, 1.031)).toEqual([1, 1.01, 1.02, 1.03, 1.04]);
    expect(niceTicks(-3, 7)).toEqual([-5, -2.5, 0, 2.5, 5, 7.5]);
  });

  test("a flat range gets a band around its value", () => {
    expect(niceTicks(80, 80)).toEqual([70, 75, 80, 85, 90]);
    expect(niceTicks(0, 0)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  test("counts start at zero", () => {
    expect(countTicks(9_431)).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(countTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(countTicks(3)).toEqual([0, 1, 2, 3, 4]);
    expect(countTicks(9)).toEqual([0, 3, 6, 9]);
    expect(countTicks(200)).toEqual([0, 50, 100, 150, 200]);
  });

  test("tick labels get the decimals their step needs", () => {
    expect(tickDecimals([60, 70])).toBe(0);
    expect(tickDecimals([1, 1.01])).toBe(2);
    expect(tickDecimals([0, 0.25])).toBe(1);
    expect(tickDecimals([5])).toBe(0);
  });
});

describe("tooltipPosition", () => {
  const chart = { width: 400, height: 200 };
  const tip = { width: 120, height: 40 };

  test("sits right of the point when it fits", () => {
    expect(tooltipPosition({ x: 100, y: 100 }, chart, tip)).toEqual({
      left: 112,
      top: 80,
    });
  });

  test("flips left near the right edge and stays inside vertically", () => {
    expect(tooltipPosition({ x: 350, y: 5 }, chart, tip)).toEqual({ left: 218, top: 0 });
  });

  test("a tooltip too wide for either side is pinned inside the chart", () => {
    expect(tooltipPosition({ x: 100, y: 190 }, { width: 200, height: 200 }, tip)).toEqual(
      {
        left: 80,
        top: 160,
      },
    );
  });
});

describe("helpers", () => {
  test("nearestIndex picks the closest value and the first on a tie", () => {
    expect(nearestIndex([10, 20, 30], 24)).toBe(1);
    expect(nearestIndex([10, 20, 30], 25)).toBe(1);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  test("labelIndexes spaces labels and always keeps the last", () => {
    expect(labelIndexes(10, 4)).toEqual([0, 3, 6, 9]);
    expect(labelIndexes(88, 8)).toEqual([0, 11, 22, 33, 44, 55, 66, 87]);
    expect(labelIndexes(3, 10)).toEqual([0, 1, 2]);
    expect(labelIndexes(0, 5)).toEqual([]);
  });

  test("truncateLabel cuts with an ellipsis", () => {
    expect(truncateLabel("Body weight", 20)).toBe("Body weight");
    expect(truncateLabel("Hemoglobin A1c/Hemoglobin.total in Blood", 12)).toBe(
      "Hemoglobin …",
    );
  });
});

describe("yearTickTimes", () => {
  test("1 January of each year inside the span", () => {
    expect(
      yearTickTimes(Date.UTC(2017, 7, 26), Date.UTC(2020, 1, 1)).map((t) =>
        new Date(t).toISOString(),
      ),
    ).toEqual([
      "2018-01-01T00:00:00.000Z",
      "2019-01-01T00:00:00.000Z",
      "2020-01-01T00:00:00.000Z",
    ]);
  });

  test("a span inside one year is labelled at its start", () => {
    expect(yearTickTimes(Date.UTC(2021, 2, 1), Date.UTC(2021, 5, 1))).toEqual([
      Date.UTC(2021, 2, 1),
    ]);
  });
});

describe("extent", () => {
  test("min and max without spreading, empty is infinite", () => {
    expect(extent([3, -1, 7])).toEqual([-1, 7]);
    expect(extent(Array.from({ length: 300_000 }, (_, i) => i))).toEqual([0, 299_999]);
    expect(extent([])).toEqual([Infinity, -Infinity]);
  });
});
