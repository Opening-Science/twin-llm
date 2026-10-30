import { describe, expect, test } from "bun:test";

import {
  countTicks,
  dateAxisTicks,
  extent,
  labelIndexes,
  nearestIndex,
  niceTicks,
  stepPath,
  tickDecimals,
  timeScale,
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

describe("dateAxisTicks", () => {
  const at = (iso: string) => Date.parse(iso);
  const labels = (start: string, end: string) =>
    dateAxisTicks(at(start), at(end)).map((tick) => tick.label);

  test("a ten-year window is labelled by year, each tick on 1 January", () => {
    const ticks = dateAxisTicks(at("2016-01-01T00:00:00Z"), at("2026-10-31T23:59:59Z"));
    expect(ticks.map((tick) => tick.label)).toEqual([
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    expect(new Date(ticks[2]!.time).toISOString()).toBe("2018-01-01T00:00:00.000Z");
  });

  test("a window of about a year names month and year", () => {
    expect(labels("2021-01-15T00:00:00Z", "2022-01-14T00:00:00Z")).toEqual([
      "Apr 2021",
      "Jul 2021",
      "Oct 2021",
      "Jan 2022",
    ]);
  });

  test("a month names day and month", () => {
    expect(labels("2026-10-01T00:00:00Z", "2026-10-31T23:59:59Z")).toEqual([
      "1 Oct",
      "7 Oct",
      "13 Oct",
      "19 Oct",
      "25 Oct",
      "31 Oct",
    ]);
  });
});

describe("timeScale", () => {
  test("x is proportional to time, not to the reading's index", () => {
    const start = Date.parse("2016-01-01T00:00:00Z");
    const end = Date.parse("2026-01-01T00:00:00Z");
    const x = timeScale(start, end, 50, 1000);
    const times = ["2016-01-01", "2016-01-02", "2021-01-01", "2026-01-01"].map((day) =>
      Date.parse(`${day}T00:00:00Z`),
    );
    expect(times.map((time) => Math.round(x(time)))).toEqual([50, 50, 550, 1050]);
  });

  test("a single instant sits in the middle", () => {
    expect(timeScale(5, 5, 10, 100)(5)).toBe(60);
  });
});

describe("stepPath", () => {
  test("one flat step per value, joined by vertical moves", () => {
    expect(stepPath([10, 10, 40], 50, 20)).toBe(
      "M50.0,10.0 H70.0 V10.0 H90.0 V40.0 H110.0",
    );
  });

  test("no values, no path", () => {
    expect(stepPath([], 0, 10)).toBe("");
  });
});
