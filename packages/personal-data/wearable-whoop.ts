import { type EffectiveTime, parseEffectiveTime } from "./effective-time";
import type { ObservationDraft } from "./types";
import {
  dayTime,
  hasColumns,
  numberField,
  readCsv,
  type WearableLayout,
} from "./wearable-files";
import { type Measure, MEASURES, measureObservation } from "./wearable-measures";

/**
 * Whoop's CSV export (`my_whoop_data`): `physiological_cycles.csv`,
 * `sleeps.csv` and `workouts.csv`, recognised by their headers. Times are
 * local with a `Cycle timezone` column such as `UTC+02:00`; a row without a
 * readable zone is reported. HRV in Whoop is RMSSD, stored by name. Sleep is
 * the minutes asleep of each main sleep on the day of waking; naps are
 * reported, not stored.
 */

const WHOOP_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/;
const WHOOP_ZONE = /^(?:UTC|GMT)?\s*([+-]\d{2}:\d{2})$/;

export type WhoopTime = Readonly<{ time: EffectiveTime; localDay: string }>;

export const whoopTime = (
  raw: string | undefined,
  zone: string | undefined,
): WhoopTime | null => {
  const time = WHOOP_TIME.exec((raw ?? "").trim());
  const offset = WHOOP_ZONE.exec((zone ?? "").trim());
  if (time === null || offset === null) return null;
  const parsed = parseEffectiveTime(`${time[1]}T${time[2]}${offset[1]}`);
  return parsed.ok ? { time: parsed.time, localDay: time[1]! } : null;
};

type Column = Readonly<{ column: string; measure: Measure }>;

const readColumns = (
  file: Readonly<{ name: string }>,
  row: Readonly<Record<string, string>>,
  rowNumber: number,
  columns: readonly Column[],
  time: EffectiveTime,
  tally: Parameters<WearableLayout["read"]>[1],
  note: string | null = null,
): readonly ObservationDraft[] =>
  columns.flatMap(({ column, measure }) => {
    const value = numberField(row[column], `${file.name}: ${column}`, tally);
    return value === null
      ? []
      : [measureObservation(measure, value, time, `${file.name} row ${rowNumber}`, note)];
  });

const CYCLE_COLUMNS: readonly Column[] = [
  { column: "Resting heart rate (bpm)", measure: MEASURES.restingHeartRate },
  { column: "Heart rate variability (ms)", measure: MEASURES.hrvRmssd },
  { column: "Blood oxygen %", measure: MEASURES.oxygenSaturation },
];

export const WHOOP_CYCLES: WearableLayout = {
  id: "whoop-cycles",
  label: "Whoop physiological cycles",
  matches: (_name, text) =>
    hasColumns(text, ["Cycle start time", "Cycle timezone", "Resting heart rate (bpm)"]),
  read: (file, tally) =>
    (readCsv(file.text)?.rows ?? []).flatMap((row, index) => {
      const start = whoopTime(row["Cycle start time"], row["Cycle timezone"]);
      if (start === null) {
        tally.add(
          file.name,
          "no-time-zone",
          "has a row without a start time and time zone",
        );
        return [];
      }
      return readColumns(file, row, index + 2, CYCLE_COLUMNS, start.time, tally);
    }),
};

export const WHOOP_SLEEPS: WearableLayout = {
  id: "whoop-sleeps",
  label: "Whoop sleeps",
  matches: (_name, text) =>
    hasColumns(text, ["Sleep onset", "Wake onset", "Asleep duration (min)", "Nap"]) &&
    !hasColumns(text, ["Recovery score %"]),
  read: (file, tally) =>
    (readCsv(file.text)?.rows ?? []).flatMap((row, index) => {
      if ((row.Nap ?? "").trim().toLowerCase() === "true") {
        tally.add(file.name, "nap", "is a nap; only the main sleep of a night is stored");
        return [];
      }
      const onset = whoopTime(row["Sleep onset"], row["Cycle timezone"]);
      const wake = whoopTime(row["Wake onset"], row["Cycle timezone"]);
      const night = wake === null ? null : dayTime(wake.localDay);
      if (onset === null || night === null) {
        tally.add(
          file.name,
          "no-time-zone",
          "has a sleep without onset, wake and time zone",
        );
        return [];
      }
      return [
        ...readColumns(
          file,
          row,
          index + 2,
          [{ column: "Asleep duration (min)", measure: MEASURES.sleepDuration }],
          night,
          tally,
        ),
        ...readColumns(
          file,
          row,
          index + 2,
          [{ column: "Respiratory rate (rpm)", measure: MEASURES.respiratoryRate }],
          onset.time,
          tally,
        ),
      ];
    }),
};

export const WHOOP_WORKOUTS: WearableLayout = {
  id: "whoop-workouts",
  label: "Whoop workouts",
  matches: (_name, text) =>
    hasColumns(text, ["Workout start time", "Cycle timezone", "Duration (min)"]),
  read: (file, tally) =>
    (readCsv(file.text)?.rows ?? []).flatMap((row, index) => {
      const start = whoopTime(row["Workout start time"], row["Cycle timezone"]);
      if (start === null) {
        tally.add(
          file.name,
          "no-time-zone",
          "has a workout without a start time and time zone",
        );
        return [];
      }
      const activity = (row["Activity name"] ?? "").trim();
      return readColumns(
        file,
        row,
        index + 2,
        [
          { column: "Duration (min)", measure: MEASURES.workoutDuration },
          { column: "Average HR (bpm)", measure: MEASURES.workoutHeartRate },
        ],
        start.time,
        tally,
        activity === "" ? null : activity,
      );
    }),
};
