import type {
  ImportedDatasetRecord,
  ImportedObservationRecord,
  ImportedSeriesGroup,
} from "./imported-ports";
import { LOINC_SYSTEM } from "./imported-ports";
import { pickReading } from "./stats";

/**
 * Pure helpers behind the imported-data tools: the listing, the newest row
 * per code, and the checks a trend needs. No I/O, so the tests check them
 * with made-up rows. A series is one dataset's LOINC code, or one dataset's
 * name stored with no code; the two are kept apart everywhere here.
 */

export type ImportedSeriesEntry = Readonly<{
  /** The LOINC code, or null for a series stored by name. */
  loinc: string | null;
  name: string;
  unit: string;
  n: number;
  first_at: string;
  last_at: string;
}>;

export type ImportedDatasetEntry = Readonly<{
  dataset_id: string;
  kind: string;
  name: string;
  row_count: number;
  first_at: string | null;
  last_at: string | null;
  series: readonly ImportedSeriesEntry[];
  /** Rows coded in a system other than LOINC; the tools do not read them yet. */
  other_coded_rows: number;
}>;

const isLoinc = (group: ImportedSeriesGroup): boolean =>
  group.code !== null && group.codeSystem === LOINC_SYSTEM;

/** LOINC series are one per code and unit; series by name one per name and unit. */
const seriesKey = (group: ImportedSeriesGroup): string =>
  group.code === null
    ? `name\u0000${group.display}\u0000${group.unit}`
    : `loinc\u0000${group.code}\u0000${group.unit}`;

const mergeGroup = (
  entry: ImportedSeriesEntry | undefined,
  group: ImportedSeriesGroup,
): ImportedSeriesEntry => {
  const first = group.firstAt.toISOString();
  const last = group.lastAt.toISOString();
  if (entry === undefined) {
    return {
      loinc: group.code,
      name: group.display,
      unit: group.unit,
      n: group.n,
      first_at: first,
      last_at: last,
    };
  }
  return {
    ...entry,
    // One code can carry a few spellings of its name; the first in order names it.
    name: group.display < entry.name ? group.display : entry.name,
    n: entry.n + group.n,
    first_at: first < entry.first_at ? first : entry.first_at,
    last_at: last > entry.last_at ? last : entry.last_at,
  };
};

const compareSeries = (a: ImportedSeriesEntry, b: ImportedSeriesEntry): number =>
  (a.loinc ?? "￿").localeCompare(b.loinc ?? "￿") ||
  a.name.localeCompare(b.name) ||
  a.unit.localeCompare(b.unit);

/**
 * Each dataset with its series. A code in two units is two entries, so the
 * model sees the units before it asks; a name stored with no code is never
 * folded into a coded series of a similar name.
 */
export const seriesListing = (
  datasets: readonly ImportedDatasetRecord[],
  groups: readonly ImportedSeriesGroup[],
): readonly ImportedDatasetEntry[] =>
  datasets.map((dataset) => {
    const own = groups.filter((group) => group.datasetId === dataset.id);
    const readable = own.filter((group) => group.code === null || isLoinc(group));
    const merged = readable.reduce((series, group) => {
      const key = seriesKey(group);
      series.set(key, mergeGroup(series.get(key), group));
      return series;
    }, new Map<string, ImportedSeriesEntry>());
    return {
      dataset_id: dataset.id,
      kind: dataset.kind,
      name: dataset.name,
      row_count: dataset.rowCount,
      first_at: dataset.firstAt,
      last_at: dataset.lastAt,
      series: [...merged.values()].sort(compareSeries),
      other_coded_rows: own
        .filter((group) => group.code !== null && !isLoinc(group))
        .reduce((total, group) => total + group.n, 0),
    };
  });

export type NewestPerCode = Readonly<{
  readings: readonly ImportedObservationRecord[];
  codesWithoutRows: readonly string[];
}>;

/**
 * The newest row of each requested code, in the order asked (a tie at one
 * instant to the lower id), and the codes with none. Rows of other codes and
 * rows with no code are ignored.
 */
export const newestPerCode = (
  rows: readonly ImportedObservationRecord[],
  codes: readonly string[],
): NewestPerCode => {
  const wanted = [...new Set(codes)];
  const picked = wanted.map((code) =>
    pickReading(
      rows
        .filter((row) => row.code === code)
        .map((row) => ({ ...row, unitUcum: row.unit })),
      null,
    ),
  );
  return {
    readings: picked.flatMap((reading) => {
      if (reading === null) return [];
      const { unitUcum: _unitUcum, ...row } = reading;
      return [row];
    }),
    codesWithoutRows: wanted.filter((_code, index) => picked[index] === null),
  };
};

/** Units as stored, sorted; `mg/dL` and `mg/dl` count as two. */
export const storedUnits = (rows: readonly Readonly<{ unit: string }>[]): string[] =>
  [...new Set(rows.map((row) => row.unit))].sort();

/**
 * Rows dated only to a month or a year (`2024-03`, `2024`). They are stored at
 * their first instant, so a slope through them would place them on a day the
 * file never gave.
 */
export const partialDateCount = (
  rows: readonly Readonly<{ effectivePrecision: string }>[],
): number =>
  rows.filter(
    (row) => row.effectivePrecision === "year" || row.effectivePrecision === "month",
  ).length;
