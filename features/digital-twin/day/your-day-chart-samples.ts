import { type YourDayReading } from "./your-day-chart";

export const SAMPLE_CURSOR_MINUTE = 14 * 60 + 32;

const readings = (values: readonly number[]): readonly YourDayReading[] =>
  values.map((value, hour) => ({
    minute: hour === 15 ? SAMPLE_CURSOR_MINUTE : Math.min(hour * 60, 1439),
    value,
  }));

export const SAMPLE_CHARTS = [
  {
    label: "Heart rate",
    unit: "bpm",
    readings: readings([
      72, 70, 67, 65, 54, 80, 128, 99, 86, 89, 84, 88, 85, 90, 83, 78, 76, 74, 72, 71, 73,
      69, 68, 66, 65,
    ]),
  },
  {
    label: "Heart rate variability",
    unit: "ms",
    readings: readings([
      62, 67, 71, 76, 69, 58, 52, 28, 42, 48, 46, 54, 49, 55, 47, 52, 54, 58, 61, 58, 66,
      64, 70, 72, 71,
    ]),
  },
] as const;
