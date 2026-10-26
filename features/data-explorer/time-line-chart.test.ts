import { describe, expect, test } from "bun:test";

import { hourTickTimes, linePath } from "./time-line-chart";

describe("hourTickTimes", () => {
  test("whole hours every two hours inside the range", () => {
    const start = Date.parse("2026-10-01T23:00:00Z");
    const end = Date.parse("2026-10-02T06:55:00Z");
    expect(hourTickTimes(start, end).map((time) => new Date(time).toISOString())).toEqual(
      [
        "2026-10-01T23:00:00.000Z",
        "2026-10-02T01:00:00.000Z",
        "2026-10-02T03:00:00.000Z",
        "2026-10-02T05:00:00.000Z",
      ],
    );
  });
});

describe("linePath", () => {
  test("bridges nothing: a gap longer than the limit starts a new run", () => {
    expect(linePath([0, 10, 30], [5, 6, 7], [0, 300_000, 1_500_000], 300_000)).toBe(
      "M0.0,5.0 L10.0,6.0 M30.0,7.0",
    );
  });

  test("one run without a limit", () => {
    expect(linePath([0, 10], [5, 6], [0, 9e9], Infinity)).toBe("M0.0,5.0 L10.0,6.0");
  });
});
