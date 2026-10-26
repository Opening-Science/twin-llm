/**
 * One subject's numeric rows turned into series: one per LOINC code and unit.
 *
 * A code stored in two units becomes two series, and nothing is converted, the
 * same rule the query tools follow with `MIXED_UNITS`. Each series carries its
 * newest reading (a tie on time goes to the lower row id, as in the Body twin's
 * Demo, so a reload shows the same value) and how well it covers the record:
 * readings, distinct UTC days, first and last day. Pure.
 */

import { utcDay } from "@/infrastructure/day-key";
import { formatNumber } from "@/infrastructure/format-measure";

export type SubjectObservation = Readonly<{
  id: string;
  loinc: string;
  display: string;
  value: number;
  unit: string;
  effectiveAt: Date;
}>;

export type SeriesPoint = Readonly<{ at: string; value: number }>;

export type SubjectSeries = Readonly<{
  key: string;
  loinc: string;
  display: string;
  unit: string;
  /**
   * Oldest first; `at` is an ISO instant. Real readings, but at most
   * `MAX_DRAWN_POINTS` of them (see `downsample`); `readings` is the full count.
   */
  points: readonly SeriesPoint[];
  latest: SeriesPoint;
  readings: number;
  days: number;
  firstDay: string;
  lastDay: string;
  /** How many units this code is stored in for this subject (1 normally). */
  unitsForCode: number;
  decimals: number;
}>;

/** More points than a chart is wide add nothing but payload. */
export const MAX_DRAWN_POINTS = 1_000;

/**
 * At most `max` of the points for drawing: the series is cut into max/2 runs
 * by position and each run keeps its lowest and highest reading, in time
 * order, so peaks and dips survive. Every kept point is a real reading with
 * its exact value; nothing is averaged.
 */
export const downsample = <T extends Readonly<{ value: number }>>(
  points: readonly T[],
  max: number = MAX_DRAWN_POINTS,
): readonly T[] => {
  if (points.length <= max) return points;
  const runs = Math.max(1, Math.floor(max / 2));
  return Array.from({ length: runs }, (_, run) => {
    const slice = points.slice(
      Math.floor((run * points.length) / runs),
      Math.floor(((run + 1) * points.length) / runs),
    );
    const low = slice.reduce((a, b) => (b.value < a.value ? b : a));
    const high = slice.reduce((a, b) => (b.value > a.value ? b : a));
    const lowFirst = slice.indexOf(low) <= slice.indexOf(high);
    return low === high ? [low] : lowFirst ? [low, high] : [high, low];
  }).flat();
};

export const seriesKey = (loinc: string, unit: string): string => `${loinc}|${unit}`;

const oldestFirst = (a: SubjectObservation, b: SubjectObservation): number =>
  a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const fractionDigits = (value: number): number => {
  const text = String(Math.abs(value));
  if (text.includes("e")) return 2;
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
};

/** Enough decimals to show what was stored, at most two. */
export const readingDecimals = (values: readonly number[]): number =>
  Math.min(
    2,
    values.reduce((most, value) => Math.max(most, fractionDigits(value)), 0),
  );

export const formatReading = (value: number, decimals: number): string =>
  formatNumber(value, decimals);

/** Series sorted by number of readings, most first, then by code. */
export const subjectSeries = (
  rows: readonly SubjectObservation[],
): readonly SubjectSeries[] => {
  const groups = Map.groupBy([...rows].sort(oldestFirst), (row) =>
    seriesKey(row.loinc, row.unit),
  );
  const unitsPerCode = Map.groupBy([...groups.values()], (group) => group[0]!.loinc);
  return (
    [...groups.entries()]
      .map(([key, group]): SubjectSeries => {
        const first = group[0]!;
        // Newest time wins; among rows at that time the lower id wins.
        const newestTime = group[group.length - 1]!.effectiveAt.getTime();
        const latest = group.find((row) => row.effectiveAt.getTime() === newestTime)!;
        const points = group.map((row) => ({
          at: row.effectiveAt.toISOString(),
          value: row.value,
        }));
        return {
          key,
          loinc: first.loinc,
          display: first.display,
          unit: first.unit,
          points,
          latest: { at: latest.effectiveAt.toISOString(), value: latest.value },
          readings: group.length,
          days: new Set(group.map((row) => utcDay(row.effectiveAt))).size,
          firstDay: utcDay(first.effectiveAt),
          lastDay: utcDay(group[group.length - 1]!.effectiveAt),
          unitsForCode: unitsPerCode.get(first.loinc)?.length ?? 1,
          decimals: readingDecimals(group.map((row) => row.value)),
        };
      })
      // Code-point order for the tie, so it never depends on the ICU build.
      .sort(
        (a, b) => b.readings - a.readings || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      )
  );
};

export type SubjectOverview = Readonly<{
  observations: number;
  codes: number;
  firstDay: string | null;
  lastDay: string | null;
}>;

export const subjectOverview = (series: readonly SubjectSeries[]): SubjectOverview => {
  const firsts = series.map((s) => s.firstDay).sort();
  const lasts = series.map((s) => s.lastDay).sort();
  return {
    observations: series.reduce((total, s) => total + s.readings, 0),
    codes: new Set(series.map((s) => s.loinc)).size,
    firstDay: firsts[0] ?? null,
    lastDay: lasts[lasts.length - 1] ?? null,
  };
};
