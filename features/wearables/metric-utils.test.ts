import { describe, expect, test } from "bun:test";

import { buildOuraSummary } from "@/features/oura/summary";

import { pointsByPrefix } from "./metric-utils";

/** A made-up night and, after it in Oura's order, an afternoon nap on the same day. */
const summary = buildOuraSummary(
  [
    {
      type: "sleep",
      data: {
        next_token: null,
        data: [
          {
            id: "night",
            day: "2026-01-03",
            type: "long_sleep",
            bedtime_start: "2026-01-03T00:25:00+01:00",
            bedtime_end: "2026-01-03T07:25:00+01:00",
            total_sleep_duration: 25_200,
            average_hrv: 48,
            average_heart_rate: 54,
          },
          {
            id: "nap",
            day: "2026-01-03",
            type: "late_nap",
            bedtime_start: "2026-01-03T14:00:00+01:00",
            bedtime_end: "2026-01-03T14:25:00+01:00",
            total_sleep_duration: 1_500,
            average_hrv: 30,
            average_heart_rate: 66,
          },
        ],
      },
    },
  ] as unknown as Parameters<typeof buildOuraSummary>[0],
  { startDate: "2026-01-03", endDate: "2026-01-03" },
);

describe("pointsByPrefix", () => {
  test("a day's point is the night's sleep, not a nap stored after it", () => {
    expect(pointsByPrefix(summary.metrics, "sleep.duration.")).toEqual([
      { date: "2026-01-03", value: 420 },
    ]);
    expect(pointsByPrefix(summary.metrics, "sleep.hr.")).toEqual([
      { date: "2026-01-03", value: 54 },
    ]);
    expect(pointsByPrefix(summary.metrics, "sleep.hrv.")).toEqual([
      { date: "2026-01-03", value: 48 },
    ]);
  });

  test("the night wins in either order", () => {
    const reversed = [...summary.metrics].reverse();
    expect(pointsByPrefix(reversed, "sleep.duration.")).toEqual([
      { date: "2026-01-03", value: 420 },
    ]);
  });

  test("a day with only a nap still has its point", () => {
    const napOnly = summary.metrics.filter((m) => !m.key.includes(".long_sleep."));
    expect(pointsByPrefix(napOnly, "sleep.duration.")).toEqual([
      { date: "2026-01-03", value: 25 },
    ]);
  });
});
