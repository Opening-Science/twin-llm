import type { health_v4 } from "googleapis";

/**
 * Made-up Google Health `dataPoints.list` responses in the API's shape (UTC
 * times with a `utcOffset`, counts as strings). No real wearer or record id.
 *
 * Steps: 1 to 7 Jan each have 1,000 steps at 8 AM, 2,000 at noon and 3,000
 * at 6 PM on a UTC+1 clock; 8 Jan has 1,500 at 8 AM and 500 at noon. Sleep:
 * the night of 8 Jan, 11:30 PM to 7 AM local, with its stages listed out of
 * order.
 */

const OFFSET = "3600s";

const interval = (startUtc: string, endUtc: string) => ({
  startTime: startUtc,
  startUtcOffset: OFFSET,
  endTime: endUtc,
  endUtcOffset: OFFSET,
});

/** One step interval of 10 minutes starting at `hourLocal` on `day`, UTC+1. */
const steps = (day: string, hourLocal: number, count: number) => {
  const utc = String(hourLocal - 1).padStart(2, "0");
  return {
    dataSource: { recordingMethod: "DERIVED", platform: "FITBIT" },
    steps: {
      interval: interval(`${day}T${utc}:00:00Z`, `${day}T${utc}:10:00Z`),
      count: String(count),
    },
  };
};

const FULL_DAYS = Array.from({ length: 7 }, (_, i) => `2026-01-0${i + 1}`);

const stage = (type: string, startUtc: string, endUtc: string) => ({
  type,
  ...interval(startUtc, endUtc),
});

export const SYNTHETIC_GOOGLE_HEALTH_RESPONSES: health_v4.Schema$ListDataPointsResponse[] =
  [
    {
      dataPoints: [
        ...FULL_DAYS.flatMap((day) => [
          steps(day, 8, 1_000),
          steps(day, 12, 2_000),
          steps(day, 18, 3_000),
        ]),
        steps("2026-01-08", 8, 1_500),
        steps("2026-01-08", 12, 500),
      ],
    },
    {
      dataPoints: [
        {
          dataSource: { recordingMethod: "AUTO_DETECTED", platform: "FITBIT" },
          sleep: {
            interval: interval("2026-01-07T22:30:00Z", "2026-01-08T06:00:00Z"),
            type: "stages",
            summary: { minutesAsleep: "445", minutesAwake: "5" },
            stages: [
              stage("LIGHT", "2026-01-07T23:45:00Z", "2026-01-08T06:00:00Z"),
              stage("LIGHT", "2026-01-07T22:30:00Z", "2026-01-07T23:00:00Z"),
              stage("REM", "2026-01-07T23:10:00Z", "2026-01-07T23:40:00Z"),
              stage("DEEP", "2026-01-07T23:00:00Z", "2026-01-07T23:10:00Z"),
              stage("AWAKE", "2026-01-07T23:40:00Z", "2026-01-07T23:45:00Z"),
            ],
          },
        },
      ],
    },
  ];
