/**
 * The cohort split by sex and 10-year age band (#4), from the counts the
 * warehouse groups by `sex`, `birth_year` and `death_year`. Pure, so the tests
 * check it with hand-counted numbers.
 *
 * Only the birth year is stored, so an age here is the year it is taken in
 * minus the birth year: the age a person reaches that year, which can be one
 * more than their age on a given day. A living subject's age is taken in the
 * reference year (the year of the cohort's latest reading), a deceased
 * subject's in the year of death. A subject without a stored sex or birth year
 * (ingested before #4 and not ingested again) is counted as not stored, never
 * put in a band.
 */

export type SubjectFactsRow = Readonly<{
  sex: string | null;
  birthYear: number | null;
  deathYear: number | null;
  subjects: number;
}>;

export const SEX_COLUMNS = ["female", "male", "other", "unknown", "not-stored"] as const;

export type SexColumn = (typeof SEX_COLUMNS)[number];

export const SEX_LABELS: Readonly<Record<SexColumn, string>> = {
  female: "Female",
  male: "Male",
  other: "Other",
  unknown: "Unknown",
  "not-stored": "Not stored",
};

export const BAND_YEARS = 10;

export type SexCounts = Readonly<Record<SexColumn, number>>;

export type AgeBand = Readonly<{
  id: string;
  label: string;
  /** First age in the band; null for the row of subjects with no birth year. */
  from: number | null;
  counts: SexCounts;
  total: number;
}>;

export type SexAgeSplit = Readonly<{
  /** The year living subjects' ages are taken in; null when the cohort has no reading. */
  referenceYear: number | null;
  /** Sex columns with at least one subject, in `SEX_COLUMNS` order. */
  columns: readonly SexColumn[];
  /** Every band from the youngest to the oldest, empty ones included, then the not-stored row. */
  bands: readonly AgeBand[];
  totals: SexCounts;
  total: number;
  deceased: number;
  /** Subjects with both a sex and a birth year stored. */
  withFacts: number;
}>;

const NO_BIRTH_YEAR = "no-birth-year";

const zeroCounts = (): Record<SexColumn, number> => ({
  female: 0,
  male: 0,
  other: 0,
  unknown: 0,
  "not-stored": 0,
});

const sexColumn = (sex: string | null): SexColumn =>
  (SEX_COLUMNS as readonly string[]).includes(sex ?? "") && sex !== "not-stored"
    ? (sex as SexColumn)
    : "not-stored";

/** The age a subject reaches in the year it is taken in; null when it cannot be told. */
export const ageInYear = (
  row: Pick<SubjectFactsRow, "birthYear" | "deathYear">,
  referenceYear: number | null,
): number | null => {
  if (row.birthYear === null) return null;
  const year = row.deathYear ?? referenceYear;
  return year === null ? null : Math.max(0, year - row.birthYear);
};

const bandStart = (age: number): number => Math.floor(age / BAND_YEARS) * BAND_YEARS;

const sumCounts = (counts: SexCounts): number =>
  SEX_COLUMNS.reduce((total, column) => total + counts[column], 0);

export const sexAgeSplit = (
  rows: readonly SubjectFactsRow[],
  referenceYear: number | null,
): SexAgeSplit => {
  const placed = rows.map((row) => {
    const age = ageInYear(row, referenceYear);
    return {
      row,
      column: sexColumn(row.sex),
      band: age === null ? NO_BIRTH_YEAR : String(bandStart(age)),
    };
  });
  const counted = placed.reduce((bands, { row, column, band }) => {
    const counts = bands.get(band) ?? zeroCounts();
    return bands.set(band, { ...counts, [column]: counts[column] + row.subjects });
  }, new Map<string, SexCounts>());
  const totals = placed.reduce(
    (sum, { row, column }) => ({ ...sum, [column]: sum[column] + row.subjects }),
    zeroCounts(),
  );
  const starts = [...counted.keys()].filter((band) => band !== NO_BIRTH_YEAR).map(Number);
  const first = starts.length === 0 ? 0 : Math.min(...starts);
  const last = starts.length === 0 ? -BAND_YEARS : Math.max(...starts);
  const bands: AgeBand[] = Array.from(
    { length: (last - first) / BAND_YEARS + 1 },
    (_, index) => {
      const from = first + index * BAND_YEARS;
      const counts = counted.get(String(from)) ?? zeroCounts();
      return {
        id: String(from),
        label: `${from}–${from + BAND_YEARS - 1}`,
        from,
        counts,
        total: sumCounts(counts),
      };
    },
  );
  const missing = counted.get(NO_BIRTH_YEAR);
  const all = missing
    ? [
        ...bands,
        {
          id: NO_BIRTH_YEAR,
          label: "Birth year not stored",
          from: null,
          counts: missing,
          total: sumCounts(missing),
        },
      ]
    : bands;
  return {
    referenceYear,
    columns: SEX_COLUMNS.filter((column) => totals[column] > 0),
    bands: all,
    totals,
    total: sumCounts(totals),
    deceased: rows
      .filter((row) => row.deathYear !== null)
      .reduce((total, row) => total + row.subjects, 0),
    withFacts: placed
      .filter(({ row, column }) => column !== "not-stored" && row.birthYear !== null)
      .reduce((total, { row }) => total + row.subjects, 0),
  };
};
