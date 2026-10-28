/**
 * The arithmetic behind the Data page, kept pure so the tests can check it with
 * hand-counted numbers and the client charts can share it with the server.
 *
 * The warehouse hands back grouped counts; these functions turn them into what
 * the page shows. Counts stay 0 when nothing was counted, but a value or a date
 * that does not exist is `null`, never 0 or an invented day. Units are never
 * converted: a code stored in two units is two series.
 */

import { utcDay } from "@/infrastructure/day-key";
import { formatNumber } from "@/infrastructure/format-measure";

/** One (code, unit) group of a cohort's numeric observations. */
export type CodeUnitRow = Readonly<{
  loinc: string;
  display: string;
  unit: string;
  rows: number;
  subjects: number;
  first: Date;
  last: Date;
}>;

/** Distinct subjects per code, across all its units. */
export type CodeSubjectsRow = Readonly<{ loinc: string; subjects: number }>;

export type YearRow = Readonly<{ year: number; rows: number; subjects: number }>;

export type CodeSummary = Readonly<{
  loinc: string;
  display: string;
  units: readonly string[];
  rows: number;
  subjects: number;
  /** subjects / cohort subjects, 0..1. */
  share: number;
}>;

export type CohortTotals = Readonly<{
  subjects: number;
  observations: number;
  nonNumeric: number;
  codes: number;
  firstDay: string | null;
  lastDay: string | null;
}>;

const byShareThenRows = (a: CodeSummary, b: CodeSummary): number =>
  b.subjects - a.subjects || b.rows - a.rows || a.loinc.localeCompare(b.loinc);

/**
 * One summary per LOINC code: its units (most rows first), the display of its
 * biggest unit group, all rows, and the share of the cohort with at least one
 * reading. Sorted widest first.
 */
export const summariseCodes = (
  unitRows: readonly CodeUnitRow[],
  codeSubjects: readonly CodeSubjectsRow[],
  subjectCount: number,
): readonly CodeSummary[] => {
  const subjectsByCode = new Map(codeSubjects.map((row) => [row.loinc, row.subjects]));
  const codes = [...new Set(unitRows.map((row) => row.loinc))];
  return codes
    .map((loinc) => {
      const groups = unitRows
        .filter((row) => row.loinc === loinc)
        .sort((a, b) => b.rows - a.rows || a.unit.localeCompare(b.unit));
      const subjects =
        subjectsByCode.get(loinc) ?? Math.max(...groups.map((group) => group.subjects));
      return {
        loinc,
        display: groups[0]!.display,
        units: groups.map((group) => group.unit),
        rows: groups.reduce((total, group) => total + group.rows, 0),
        subjects,
        share: subjectCount > 0 ? subjects / subjectCount : 0,
      };
    })
    .sort(byShareThenRows);
};

export const cohortTotals = (
  unitRows: readonly CodeUnitRow[],
  subjects: number,
  nonNumeric: number,
): CohortTotals => {
  const firsts = unitRows.map((row) => row.first.getTime());
  const lasts = unitRows.map((row) => row.last.getTime());
  const first = firsts.reduce((low, time) => Math.min(low, time), Infinity);
  const last = lasts.reduce((high, time) => Math.max(high, time), -Infinity);
  return {
    subjects,
    observations: unitRows.reduce((total, row) => total + row.rows, 0),
    nonNumeric,
    codes: new Set(unitRows.map((row) => row.loinc)).size,
    firstDay: firsts.length === 0 ? null : utcDay(new Date(first)),
    lastDay: lasts.length === 0 ? null : utcDay(new Date(last)),
  };
};

/**
 * Every year from the first to the last with data. A year with no row is a
 * real count of 0 observations, so it stays on the axis rather than vanishing.
 */
export const yearSeries = (rows: readonly YearRow[]): readonly YearRow[] => {
  if (rows.length === 0) return [];
  const years = rows.map((row) => row.year);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const byYear = new Map(rows.map((row) => [row.year, row]));
  return Array.from(
    { length: last - first + 1 },
    (_, i) => byYear.get(first + i) ?? { year: first + i, rows: 0, subjects: 0 },
  );
};

export const WIDE_SHARE = 0.8;
export const SPARSE_SHARE = 0.1;

export type CoverageSplit = Readonly<{
  wide: readonly CodeSummary[];
  sparse: readonly CodeSummary[];
}>;

/** Codes at least 80% of subjects have, and codes under 10% have (rarest first). */
export const coverageSplit = (codes: readonly CodeSummary[]): CoverageSplit => ({
  wide: codes.filter((code) => code.share >= WIDE_SHARE),
  sparse: [...codes.filter((code) => code.share < SPARSE_SHARE)].reverse(),
});

/** A share as a percentage: one decimal under 10%, whole numbers above. */
export const formatShare = (share: number): string =>
  `${formatNumber(share * 100, share > 0 && share < 0.1 ? 1 : 0)}%`;

/** Units of a code as one label: `kg`, or `mg/dL · mmol/L` when it has two. */
export const unitLabel = (units: readonly string[]): string => units.join(" · ");
