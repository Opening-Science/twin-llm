import type { EffectiveTime } from "./effective-time";
import {
  dayTime,
  isRecord,
  numberField,
  readJson,
  type WearableLayout,
} from "./wearable-files";
import { MEASURES, measureObservation } from "./wearable-measures";

/**
 * Fitbit data from Google Takeout: the daily JSON files named
 * `<metric>-YYYY-MM-DD.json`, each an array. Read: `resting_heart_rate`
 * (Fitbit writes 0 for a day without a reading, which is reported, not
 * stored), `sleep` (minutes asleep of the main sleep, on `dateOfSleep`) and
 * `weight` (BMI only: the weight has no unit in the file, and kg or lb would
 * be a guess). Per-sample `steps` and `heart_rate` files have times without
 * a time zone, so they are recognised and reported, not summed into a day.
 */

const FITBIT_DATE = /^(\d{2})\/(\d{2})\/(\d{2})(?: \d{2}:\d{2}:\d{2})?$/;

/** Fitbit's `MM/DD/YY` as a day; years are 20YY. */
export const fitbitDay = (raw: unknown): EffectiveTime | null => {
  if (typeof raw !== "string") return null;
  const match = FITBIT_DATE.exec(raw.trim());
  return match === null ? null : dayTime(`20${match[3]}-${match[1]}-${match[2]}`);
};

const named = (prefix: string) => (name: string) =>
  new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(name);

const entries = (text: string): readonly Readonly<Record<string, unknown>>[] => {
  const root = readJson(text);
  return Array.isArray(root) ? root.filter(isRecord) : [];
};

const isJsonArray = (text: string) => Array.isArray(readJson(text));

export const FITBIT_RESTING_HEART_RATE: WearableLayout = {
  id: "fitbit-resting-heart-rate",
  label: "Fitbit resting heart rate (Google Takeout)",
  matches: (name, text) => named("resting_heart_rate")(name) && isJsonArray(text),
  read: (file, tally) =>
    entries(file.text).flatMap((entry, index) => {
      const value = isRecord(entry.value) ? entry.value : {};
      const time = fitbitDay(value.date);
      if (time === null) {
        tally.add(file.name, "no-day", "has an entry without a date");
        return [];
      }
      if (value.value === 0) {
        tally.add(
          file.name,
          "zero-means-none",
          "is 0, which Fitbit writes for a day without a reading",
        );
        return [];
      }
      const bpm = numberField(value.value, `${file.name}: value`, tally);
      return bpm === null
        ? []
        : [
            measureObservation(
              MEASURES.restingHeartRate,
              bpm,
              time,
              `${file.name} entry ${index + 1}`,
            ),
          ];
    }),
};

export const FITBIT_SLEEP: WearableLayout = {
  id: "fitbit-sleep",
  label: "Fitbit sleep (Google Takeout)",
  matches: (name, text) => named("sleep")(name) && isJsonArray(text),
  read: (file, tally) => {
    const seen = new Set<string>();
    return entries(file.text).flatMap((entry, index) => {
      if (entry.mainSleep !== true) {
        tally.add(file.name, "nap", "is a nap; only the main sleep of a night is stored");
        return [];
      }
      const time = dayTime(entry.dateOfSleep);
      if (time === null) {
        tally.add(file.name, "no-day", "has a sleep without dateOfSleep");
        return [];
      }
      const night = String(entry.dateOfSleep);
      if (seen.has(night)) {
        tally.add(
          file.name,
          "second-main-sleep",
          "is a second main sleep on the same night",
        );
        return [];
      }
      seen.add(night);
      const minutes = numberField(
        entry.minutesAsleep,
        `${file.name}: minutesAsleep`,
        tally,
      );
      return minutes === null
        ? []
        : [
            measureObservation(
              MEASURES.sleepDuration,
              minutes,
              time,
              `${file.name} entry ${index + 1}`,
            ),
          ];
    });
  },
};

export const FITBIT_WEIGHT: WearableLayout = {
  id: "fitbit-weight",
  label: "Fitbit weight log (Google Takeout)",
  matches: (name, text) => named("weight")(name) && isJsonArray(text),
  read: (file, tally) =>
    entries(file.text).flatMap((entry, index) => {
      if (entry.weight !== undefined) {
        tally.add(
          file.name,
          "unit-not-stated",
          "has a weight without a unit (kg or lb), so the weight is not stored",
        );
      }
      const time = fitbitDay(entry.date);
      if (time === null) {
        tally.add(file.name, "no-day", "has an entry without a date");
        return [];
      }
      const bmi = numberField(entry.bmi, `${file.name}: bmi`, tally);
      return bmi === null
        ? []
        : [
            measureObservation(
              MEASURES.bodyMassIndex,
              bmi,
              time,
              `${file.name} entry ${index + 1}`,
            ),
          ];
    }),
};

export const FITBIT_SAMPLES: WearableLayout = {
  id: "fitbit-samples",
  label: "Fitbit per-sample steps or heart rate (Google Takeout)",
  matches: (name, text) =>
    (named("steps")(name) || named("heart_rate")(name)) && isJsonArray(text),
  read: (file, tally) => {
    tally.add(
      file.name,
      "no-time-zone",
      "has per-sample times without a time zone; a daily total would be a guess",
    );
    return [];
  },
};
