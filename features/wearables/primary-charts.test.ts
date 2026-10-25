import { describe, expect, test } from "bun:test";

import type { Metric } from "./metric-utils";
import { primaryCharts } from "./primary-charts";

// Synthetic fixture rows, not anyone's data.
const metric = (key: string, value: number, date: string): Metric => ({
  key: `${key}.${date}`,
  label: key,
  value,
  date,
});

describe("primaryCharts", () => {
  test("Google Health steps and resting HR get a chart each", () => {
    const charts = primaryCharts("google-health", [
      metric("google.steps", 11_201, "2026-01-01"),
      metric("google.daily-resting-heart-rate", 58, "2026-01-01"),
    ]);
    expect(
      charts.map((chart) => chart.map((series) => [series.label, series.kind])),
    ).toEqual([[["Steps", "steps"]], [["Resting HR", "heartRate"]]]);
    expect(charts[1]?.[0]?.points).toEqual([{ date: "2026-01-01", value: 58 }]);
    expect(charts.map((chart) => chart[0]?.className)).toEqual([
      "text-chart-1",
      "text-chart-2",
    ]);
  });

  test("steps without resting HR rows give one chart, not an empty one", () => {
    const charts = primaryCharts("google-health", [
      metric("google.steps", 9800, "2026-01-01"),
      metric("google.steps", 11_201, "2026-01-02"),
    ]);
    expect(charts.map((chart) => chart.map((series) => series.label))).toEqual([
      ["Steps"],
    ]);
  });

  test("two Oura scores share one chart", () => {
    const charts = primaryCharts("oura", [
      metric("sleep.score", 72, "2026-01-01"),
      metric("readiness.score", 88, "2026-01-01"),
    ]);
    expect(charts.map((chart) => chart.map((series) => series.label))).toEqual([
      ["Sleep score", "Readiness"],
    ]);
  });

  test("no metrics in the window, no charts", () => {
    expect(primaryCharts("whoop", [])).toEqual([]);
  });
});
