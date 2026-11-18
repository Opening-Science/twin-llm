import { type DayReading } from "./day-beats";
import MOCK_DAY from "./fixtures/mock-day.json";

/**
 * The illustrative mock day (`fixtures/mock-day.json`) as day readings: a
 * made-up day for one synthetic person, not a recording of anyone. Each
 * reading has heart rate, blood glucose and an illustrative sensor glucose
 * that trails the blood value. Which glucose the day carries:
 *
 * - `blood`: blood glucose only, the day as first written;
 * - `sensor`: sensor glucose only, a day from someone who wears a monitor;
 * - `both`: the two side by side, as when a finger prick checks the sensor.
 */

export const MOCK_DAY_GLUCOSE = ["blood", "sensor", "both"] as const;
export type MockDayGlucose = (typeof MOCK_DAY_GLUCOSE)[number];

export const MOCK_DAY_DATE: string = MOCK_DAY.day;

export const mockDayReadings = (glucose: MockDayGlucose): readonly DayReading[] =>
  MOCK_DAY.readings.map((one) => ({
    time: one.time,
    event: one.event,
    heartRatePerMin: one.heart_rate_per_min,
    glucoseMgDl: glucose === "sensor" ? null : one.glucose_mg_dl,
    ...(glucose === "blood" ? {} : { sensorGlucoseMgDl: one.sensor_glucose_mg_dl }),
    moving: one.moving,
  }));
