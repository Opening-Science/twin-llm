import { DAY_THRESHOLDS, dayBeats, type GlucoseProfile, redWindows } from "./day-beats";
import { type KioskDay, toKioskDay } from "./kiosk-day";
import { MOCK_DAY_DATE, type MockDayGlucose, mockDayReadings } from "./mock-day";

/**
 * The illustrative mock day (`fixtures/mock-day.json`, read by `mock-day.ts`)
 * in the kiosk's shape: made-up values for one synthetic person, activity
 * recorded. It reads no subject, so it is what a screen in a public room can
 * play, and it is the one builder of the mock kiosk day: the twin page's
 * route and the kiosk both call it. The committed example
 * `docs/kiosk-day.example.json` is this day without diabetes, blood glucose
 * only.
 */

/** The subject_ref the mock day carries; never a warehouse subject. */
export const MOCK_DAY_REF = "synthetic-mock-day";

const MEASURED = " · measured";

/**
 * A mock reading was never measured, so its line says so. `source` keeps the
 * contract's value: the beat still stands for one reading.
 */
const illustrative = (day: KioskDay): KioskDay => ({
  ...day,
  beats: day.beats.map((beat) =>
    beat.source === "measured" && beat.line.endsWith(MEASURED)
      ? {
          ...beat,
          line: `${beat.line.slice(0, -MEASURED.length)} · illustrative, not measured`,
        }
      : beat,
  ),
});

export const mockKioskDay = (
  profile: GlucoseProfile,
  glucose: MockDayGlucose = "blood",
): KioskDay => {
  const readings = mockDayReadings(glucose);
  const day = toKioskDay({
    subject_ref: MOCK_DAY_REF,
    day: MOCK_DAY_DATE,
    profile,
    beats: dayBeats(readings, profile),
    red_windows: redWindows(readings, profile),
    thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
    activity: "recorded",
    timezone: "UTC",
  });
  return illustrative(day);
};
