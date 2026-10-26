import { describe, expect, test } from "bun:test";

import { timeseriesView } from "@/infrastructure/chat-view";

import { viewChart } from "./view-chart";

const viewWith = (points: readonly { at: string; value: number }[]) =>
  timeseriesView({
    spec: {
      measure: "8867-4",
      label: "Heart rate",
      unit: "/min",
      window: { start: "2016-01-01", end: "2026-10-31" },
      subject: "synthetic-subject-1",
      points,
    },
    sourceAuditIds: ["9"],
  });

describe("viewChart", () => {
  test("keeps every reading at its own time, and the window is the x range", () => {
    const points = [
      { at: "2017-03-02T08:00:00.000Z", value: 61 },
      { at: "2017-03-02T20:00:00.000Z", value: 66.5 },
      { at: "2024-10-05T08:00:00.000Z", value: 64 },
    ];
    expect(viewChart(viewWith(points))).toEqual({
      points,
      domain: [
        Date.parse("2016-01-01T00:00:00.000Z"),
        Date.parse("2026-10-31T23:59:59.999Z"),
      ],
      decimals: 1,
    });
  });

  test("no readings gives no chart, so nothing is drawn", () => {
    expect(viewChart(viewWith([]))).toBeNull();
  });
});
