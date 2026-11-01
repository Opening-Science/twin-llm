import { describe, expect, test } from "bun:test";

import { dashboardCards } from "./dashboard-cards";
import type { Metric } from "./metric-utils";

const series = (prefix: string, values: readonly number[]): Metric[] =>
  values.map((value, index) => {
    const date = `2026-10-0${index + 1}`;
    return { key: `${prefix}${date}`, label: prefix, value, date };
  });

const layout = (cards: ReturnType<typeof dashboardCards>): string =>
  cards.map((card) => `${card.id}:${card.span.cols}x${card.span.rows}`).join(" ");

describe("dashboardCards", () => {
  test("a full Oura window fills every row", () => {
    const metrics = [
      ...series("sleep.hr.long_sleep.", [55, 54]),
      ...series("sleep.duration.long_sleep.", [420, 450]),
      ...series("sleep.hrv.long_sleep.", [40, 44]),
      ...series("activity.steps.", [8000, 9000]),
    ];
    expect(
      layout(
        dashboardCards({ source: "oura", metrics, timelineCharts: 1, linkedSources: 2 }),
      ),
    ).toBe(
      "summary:4x1 heart:2x2 timeline:2x2 sleep:2x1 hrv:1x1 steps:1x1 sources:2x1 privacy:2x1",
    );
  });

  test("Whoop has no steps, so sleep and HRV share the row evenly", () => {
    const metrics = [
      ...series("whoop.recovery.rhr.", [52, 51]),
      ...series("whoop.sleep.in_bed_min.", [480]),
      ...series("whoop.recovery.hrv.", [60, 62]),
    ];
    expect(
      layout(
        dashboardCards({
          source: "whoop",
          metrics,
          timelineCharts: 1,
          linkedSources: 1,
        }),
      ),
    ).toBe(
      "summary:4x1 heart:2x2 timeline:2x2 sleep:2x1 hrv:2x1 sources:2x1 privacy:2x1",
    );
  });

  test("a heart rate with one day is no trend; the timeline takes the row", () => {
    const metrics = [
      ...series("google.daily-resting-heart-rate.", [60]),
      ...series("google.steps.", [7000, 7100]),
    ];
    expect(
      layout(
        dashboardCards({
          source: "google-health",
          metrics,
          timelineCharts: 2,
          linkedSources: 1,
        }),
      ),
    ).toBe("summary:4x1 timeline:4x1 steps:4x1 sources:2x1 privacy:2x1");
  });

  test("an empty window keeps only the summary and privacy", () => {
    expect(
      layout(
        dashboardCards({
          source: "oura",
          metrics: [],
          timelineCharts: 0,
          linkedSources: 0,
        }),
      ),
    ).toBe("summary:4x1 privacy:4x1");
  });
});
