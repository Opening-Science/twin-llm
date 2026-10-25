import { describe, expect, test } from "bun:test";

import {
  downsample,
  formatReading,
  readingDecimals,
  type SubjectObservation,
  subjectOverview,
  subjectSeries,
} from "./subject-series";
import { subjectStory } from "./subject-story";

const obs = (
  id: string,
  loinc: string,
  unit: string,
  value: number,
  at: string,
  display = `Code ${loinc}`,
): SubjectObservation => ({ id, loinc, display, value, unit, effectiveAt: new Date(at) });

const ROWS = [
  obs("r3", "29463-7", "kg", 81.3, "2020-03-01T10:00:00Z", "Body weight"),
  obs("r1", "29463-7", "kg", 80, "2018-01-05T09:00:00Z", "Body weight"),
  obs("r2", "29463-7", "kg", 80.75, "2018-01-05T17:00:00Z", "Body weight"),
  obs("u1", "5811-5", "{SG}", 1.02, "2019-06-01T08:00:00Z", "Specific gravity"),
  obs("u2", "5811-5", "1", 1.015, "2021-06-01T08:00:00Z", "Specific gravity"),
  // Two rows at the same instant: the lower id is the latest value.
  obs("h9", "8867-4", "/min", 71, "2022-02-02T12:00:00Z", "Heart rate"),
  obs("h2", "8867-4", "/min", 64, "2022-02-02T12:00:00Z", "Heart rate"),
];

describe("subjectSeries", () => {
  const series = subjectSeries(ROWS);

  test("one series per code and unit, most readings first, then by key", () => {
    expect(series.map((s) => s.key)).toEqual([
      "29463-7|kg",
      "8867-4|/min",
      "5811-5|1",
      "5811-5|{SG}",
    ]);
  });

  test("points are oldest first; readings, days, first and last day are counted", () => {
    const weight = series[0]!;
    expect(weight.points).toEqual([
      { at: "2018-01-05T09:00:00.000Z", value: 80 },
      { at: "2018-01-05T17:00:00.000Z", value: 80.75 },
      { at: "2020-03-01T10:00:00.000Z", value: 81.3 },
    ]);
    expect(weight.readings).toBe(3);
    expect(weight.days).toBe(2);
    expect(weight.firstDay).toBe("2018-01-05");
    expect(weight.lastDay).toBe("2020-03-01");
    expect(weight.latest).toEqual({ at: "2020-03-01T10:00:00.000Z", value: 81.3 });
    expect(weight.decimals).toBe(2);
    expect(weight.unitsForCode).toBe(1);
  });

  test("a tie on the newest time goes to the lower row id", () => {
    expect(series[1]!.latest).toEqual({ at: "2022-02-02T12:00:00.000Z", value: 64 });
  });

  test("a code in two units is two series, each knowing there are two", () => {
    const gravity = series.filter((s) => s.loinc === "5811-5");
    expect(gravity.map((s) => [s.unit, s.unitsForCode, s.readings])).toEqual([
      ["1", 2, 1],
      ["{SG}", 2, 1],
    ]);
  });

  test("the overview adds readings and spans every series", () => {
    expect(subjectOverview(series)).toEqual({
      observations: 7,
      codes: 3,
      firstDay: "2018-01-05",
      lastDay: "2022-02-02",
    });
    expect(subjectOverview([])).toEqual({
      observations: 0,
      codes: 0,
      firstDay: null,
      lastDay: null,
    });
  });
});

describe("readings", () => {
  test("decimals follow what was stored, at most two", () => {
    expect(readingDecimals([80, 120])).toBe(0);
    expect(readingDecimals([5.5, 6])).toBe(1);
    expect(readingDecimals([1.015, 1.02])).toBe(2);
    expect(readingDecimals([])).toBe(0);
  });

  test("a reading is grouped and rounded half away from zero", () => {
    expect(formatReading(1234.5, 0)).toBe("1,235");
    expect(formatReading(1.015, 2)).toBe("1.02");
    expect(formatReading(Number.NaN, 1)).toBe("—");
  });
});

describe("subjectStory", () => {
  test("describes the record from counts, with the three codes read most", () => {
    const series = subjectSeries(ROWS);
    expect(subjectStory(subjectOverview(series), series, 12)).toBe(
      "This synthetic subject has 7 numeric observations of 3 LOINC codes, from 5 Jan 2018 to 2 Feb 2022, and 12 text observations. Most readings: Body weight, Heart rate and Specific gravity.",
    );
  });

  test("one of each reads in the singular, and no text observations are left out", () => {
    const series = subjectSeries([ROWS[0]!]);
    expect(subjectStory(subjectOverview(series), series, 0)).toBe(
      "This synthetic subject has 1 numeric observation of 1 LOINC code, from 1 Mar 2020 to 1 Mar 2020. Most readings: Body weight.",
    );
  });

  test("a subject with no numeric rows says so", () => {
    expect(subjectStory(subjectOverview([]), [], 1)).toBe(
      "This synthetic subject has no numeric observations, and 1 text observation.",
    );
  });
});

describe("downsample", () => {
  const points = (values: readonly number[]) => values.map((value, i) => ({ i, value }));

  test("a series within the limit is unchanged", () => {
    const series = points([3, 1, 2]);
    expect(downsample(series, 4)).toBe(series);
  });

  test("keeps the lowest and highest of each run, in time order, exact values", () => {
    expect(downsample(points([5, 9, 1, 4, 7, 7, 2, 8]), 4)).toEqual([
      { i: 1, value: 9 },
      { i: 2, value: 1 },
      { i: 6, value: 2 },
      { i: 7, value: 8 },
    ]);
  });

  test("a flat run keeps one point, and 50,000 readings shrink to the limit", () => {
    expect(downsample(points([4, 4, 4, 4, 4]), 2)).toEqual([{ i: 0, value: 4 }]);
    const long = points(Array.from({ length: 50_000 }, (_, i) => Math.sin(i / 50)));
    expect(downsample(long).length).toBeLessThanOrEqual(1_000);
  });
});
