import type { ObservationDraft } from "./types";
import {
  dayTime,
  hasColumns,
  isRecord,
  numberField,
  readCsv,
  readJson,
  type WearableLayout,
} from "./wearable-files";
import {
  type Measure,
  MEASURES,
  measureObservation,
  wholeMinutes,
} from "./wearable-measures";

/**
 * Oura's data export, as JSON with the collections `sleep`, `daily_activity`
 * and `daily_spo2` (each an array of documents with a `day`, or `{ data:
 * [...] }`), or the trends CSV with a `date` column. Values are per day.
 * Sleep is the main sleep of each day (Oura's `long_sleep`, else the
 * longest period), in whole minutes; the other periods are reported. HRV is
 * RMSSD and the lowest heart rate in sleep is not a resting rate, so both
 * are stored by name without a code.
 */

const OURA_COLLECTIONS = ["sleep", "daily_activity", "daily_spo2"] as const;

const collection = (
  root: Readonly<Record<string, unknown>>,
  key: string,
): readonly unknown[] => {
  const value = root[key];
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.data)) return value.data;
  return [];
};

type Tally = Parameters<WearableLayout["read"]>[1];

const field = (
  file: Readonly<{ name: string }>,
  key: string,
  document: Readonly<Record<string, unknown>>,
  path: string,
  measure: Measure,
  tally: Tally,
  transform: (value: number) => number = (value) => value,
): readonly ObservationDraft[] => {
  const time = dayTime(document.day);
  if (time === null) {
    tally.add(`${file.name}: ${key}`, "no-day", "has a document without a day");
    return [];
  }
  const raw = path
    .split(".")
    .reduce<unknown>(
      (value, part) => (isRecord(value) ? value[part] : undefined),
      document,
    );
  const value = numberField(raw, `${file.name}: ${key}.${path}`, tally);
  return value === null
    ? []
    : [
        measureObservation(
          measure,
          transform(value),
          time,
          `${file.name} ${key} ${String(document.day)}`,
        ),
      ];
};

/** The main sleep document of each day: `long_sleep`, else the longest. */
const mainSleeps = (
  documents: readonly Readonly<Record<string, unknown>>[],
): ReadonlySet<Readonly<Record<string, unknown>>> => {
  const rank = (document: Readonly<Record<string, unknown>>) =>
    [
      document.type === "long_sleep" ? 1 : 0,
      typeof document.total_sleep_duration === "number"
        ? document.total_sleep_duration
        : -1,
    ] as const;
  const best = new Map<unknown, Readonly<Record<string, unknown>>>();
  for (const document of documents) {
    const known = best.get(document.day);
    const [a1, a2] = rank(document);
    const better =
      known === undefined ||
      a1 > rank(known)[0] ||
      (a1 === rank(known)[0] && a2 > rank(known)[1]);
    if (better) best.set(document.day, document);
  }
  return new Set(best.values());
};

export const OURA_JSON: WearableLayout = {
  id: "oura-json",
  label: "Oura data export (JSON)",
  matches: (name, text) => {
    if (!name.toLowerCase().endsWith(".json")) return false;
    const root = readJson(text);
    return isRecord(root) && OURA_COLLECTIONS.some((key) => key in root);
  },
  read: (file, tally) => {
    const root = readJson(file.text);
    if (!isRecord(root)) return [];
    const documents = (key: string) => collection(root, key).filter(isRecord);
    const sleeps = documents("sleep");
    const main = mainSleeps(sleeps);
    const sleepRows = sleeps.flatMap((document) => {
      if (!main.has(document)) {
        tally.add(
          `${file.name}: sleep`,
          "not-main-sleep",
          "is a nap or rest period; only the main sleep of a day is stored",
        );
        return [];
      }
      return [
        ...field(
          file,
          "sleep",
          document,
          "total_sleep_duration",
          MEASURES.sleepDuration,
          tally,
          wholeMinutes,
        ),
        ...field(
          file,
          "sleep",
          document,
          "lowest_heart_rate",
          MEASURES.lowestSleepHeartRate,
          tally,
        ),
        ...field(file, "sleep", document, "average_hrv", MEASURES.hrvRmssd, tally),
        ...field(
          file,
          "sleep",
          document,
          "average_breath",
          MEASURES.respiratoryRate,
          tally,
        ),
      ];
    });
    return [
      ...sleepRows,
      ...documents("daily_activity").flatMap((document) =>
        field(file, "daily_activity", document, "steps", MEASURES.stepsPerDay, tally),
      ),
      ...documents("daily_spo2").flatMap((document) =>
        field(
          file,
          "daily_spo2",
          document,
          "spo2_percentage.average",
          MEASURES.oxygenSaturation,
          tally,
        ),
      ),
    ];
  },
};

type TrendColumn = Readonly<{
  column: string;
  measure: Measure;
  transform?: (value: number) => number;
}>;

const TREND_COLUMNS: readonly TrendColumn[] = [
  {
    column: "Total Sleep Duration",
    measure: MEASURES.sleepDuration,
    transform: wholeMinutes,
  },
  { column: "Lowest Resting Heart Rate", measure: MEASURES.lowestSleepHeartRate },
  { column: "Average HRV", measure: MEASURES.hrvRmssd },
  { column: "Respiratory Rate", measure: MEASURES.respiratoryRate },
  { column: "Steps", measure: MEASURES.stepsPerDay },
];

export const OURA_TRENDS_CSV: WearableLayout = {
  id: "oura-trends-csv",
  label: "Oura trends (CSV)",
  matches: (_name, text) =>
    hasColumns(text, ["date", "Total Sleep Duration"]) &&
    !hasColumns(text, ["Cycle timezone"]),
  read: (file, tally) => {
    const table = readCsv(file.text);
    if (table === null) return [];
    const columns = TREND_COLUMNS.filter(({ column }) => table.header.includes(column));
    return table.rows.flatMap((row, index) => {
      const time = dayTime((row.date ?? "").trim());
      if (time === null) {
        tally.add(file.name, "no-day", "has a row without a calendar day (2026-09-01)");
        return [];
      }
      return columns.flatMap(({ column, measure, transform }) => {
        const value = numberField(row[column], `${file.name}: ${column}`, tally);
        return value === null
          ? []
          : [
              measureObservation(
                measure,
                transform === undefined ? value : transform(value),
                time,
                `${file.name} row ${index + 2}`,
              ),
            ];
      });
    });
  },
};
