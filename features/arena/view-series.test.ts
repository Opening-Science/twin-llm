import { describe, expect, test } from "bun:test";

import { timeseriesView } from "@/infrastructure/chat-view";

import { viewChartSeries } from "./view-series";

const viewWith = (points: readonly { at: string; value: number }[]) =>
  timeseriesView({
    spec: {
      measure: "8867-4",
      label: "Heart rate",
      unit: "/min",
      window: { start: "2026-10-01", end: "2026-10-31" },
      subject: "synthetic-subject-1",
      points,
    },
    sourceAuditIds: ["9"],
  });

describe("viewChartSeries", () => {
  test("one point per day, the day's last reading", () => {
    expect(
      viewChartSeries(
        viewWith([
          { at: "2026-10-02T08:00:00.000Z", value: 61 },
          { at: "2026-10-02T20:00:00.000Z", value: 66 },
          { at: "2026-10-05T08:00:00.000Z", value: 64 },
        ]),
      )?.points,
    ).toEqual([
      { date: "2026-10-02", value: 66 },
      { date: "2026-10-05", value: 64 },
    ]);
  });

  test("no readings gives no series, so nothing is drawn", () => {
    expect(viewChartSeries(viewWith([]))).toBeNull();
  });
});
