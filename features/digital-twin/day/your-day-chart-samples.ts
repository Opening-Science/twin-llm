import {
  DEMO_PERSON_A,
  DEMO_TIME_ZONE,
  demoReplayDay,
} from "@/packages/query-tools/replay/demo-days";
import { type ReplayReading } from "@/packages/query-tools/replay/items";
import { localClock } from "@/packages/query-tools/replay/local-time";

import { YOUR_DAY_COPY } from "../twin-page-copy";
import { type YourDayReading } from "./your-day-chart";

/**
 * Placeholder charts until replay feeds Your Day: heart rate and sensor glucose
 * from one deterministic synthetic demo day (#896), so the samples match what
 * replay will show. A full day with a run and no sensor gap, since the chart
 * does not draw gaps yet. Shown as "Sample data", never as a person's values.
 */
const SAMPLE_DAY = "2026-10-29";

/** 08:15, the top of the post-breakfast glucose rise. */
export const SAMPLE_CURSOR_MINUTE = 8 * 60 + 15;

const day = demoReplayDay(DEMO_PERSON_A, SAMPLE_DAY);
if (day === null) throw new Error(`no demo day ${SAMPLE_DAY}`);

const minuteOf = (at: string): number => {
  const [hours, minutes] = localClock(new Date(at), DEMO_TIME_ZONE)
    .time.split(":")
    .map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

const series = (keep: (reading: ReplayReading) => boolean): readonly YourDayReading[] =>
  day.readings.flatMap((reading) =>
    keep(reading) && reading.availability === "available" && reading.value !== null
      ? [{ minute: minuteOf(reading.at), value: reading.value }]
      : [],
  );

export const SAMPLE_CHARTS = [
  {
    label: YOUR_DAY_COPY.chart.heartRate,
    unit: "bpm",
    readings: series((reading) => reading.stream === "heart_rate"),
  },
  {
    label: YOUR_DAY_COPY.chart.glucose,
    unit: "mg/dL",
    readings: series(
      (reading) => reading.stream === "glucose" && reading.specimen === "sensor",
    ),
  },
] as const;
