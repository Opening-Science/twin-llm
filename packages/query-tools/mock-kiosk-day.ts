import {
  DAY_THRESHOLDS,
  type DayReading,
  dayBeats,
  type GlucoseProfile,
  redWindows,
} from "./day-beats";
import MOCK_DAY from "./fixtures/mock-day.json";
import { type KioskDay, toKioskDay } from "./kiosk-day";

/**
 * The illustrative mock day (`fixtures/mock-day.json`) in the kiosk's shape:
 * made-up values for one synthetic person, activity recorded. It reads no
 * subject, so it is what a screen in a public room can play. The committed
 * example `docs/kiosk-day.example.json` is this day without diabetes.
 */

/** The subject_ref the mock day carries; never a warehouse subject. */
export const MOCK_DAY_REF = "synthetic-mock-day";

const MOCK_READINGS: readonly DayReading[] = MOCK_DAY.readings.map((one) => ({
  time: one.time,
  event: one.event,
  heartRatePerMin: one.heart_rate_per_min,
  glucoseMgDl: one.glucose_mg_dl,
  moving: one.moving,
}));

export const mockKioskDay = (profile: GlucoseProfile): KioskDay =>
  toKioskDay({
    subject_ref: MOCK_DAY_REF,
    day: MOCK_DAY.day,
    profile,
    beats: dayBeats(MOCK_READINGS, profile),
    red_windows: redWindows(MOCK_READINGS, profile),
    thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
    activity: "recorded",
    timezone: "UTC",
  });
