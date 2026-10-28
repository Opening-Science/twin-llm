/**
 * How closely two wearables agree on one measure, day by day
 * (`cross_source_compare`). Only days both recorded count. The result says
 * how far apart the two read and how they move together; it never says which
 * device is right, and it never converts a unit.
 *
 * Pure: the tool in tools.ts reads the snapshots and does the audit.
 */
import type { DayReading } from "./wearable-readings";

/** Paired days a comparison needs before it reports a spread or a correlation. */
export const AGREEMENT_MINIMUM = 7;

export type SourceAgreement = Readonly<{
  /** Days both sources recorded in the window. */
  n_pairs: number;
  first_day: string | null;
  last_day: string | null;
  mean_a: number | null;
  mean_b: number | null;
  /** Mean of (b − a) over the paired days. */
  mean_difference: number | null;
  /** Sample standard deviation of (b − a). */
  sd_difference: number | null;
  /** mean_difference ± 1.96 × sd_difference: where most daily differences fall. */
  limits_of_agreement: Readonly<{ low: number; high: number }> | null;
  /** Pearson correlation of the paired values; null when either side does not vary. */
  pearson_r: number | null;
}>;

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleSd = (values: readonly number[]): number => {
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1),
  );
};

const pearson = (xs: readonly number[], ys: readonly number[]): number | null => {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, index) => {
    const y = ys[index] ?? 0;
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  });
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
};

/** The days both series have, oldest first, as [a, b] values. */
export const pairByDay = (
  a: readonly DayReading[],
  b: readonly DayReading[],
): readonly Readonly<{ day: string; a: number; b: number }>[] => {
  const bByDay = new Map(b.map((reading) => [reading.day, reading.value]));
  return a
    .flatMap((reading) => {
      const other = bByDay.get(reading.day);
      return other === undefined
        ? []
        : [{ day: reading.day, a: reading.value, b: other }];
    })
    .sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
};

/**
 * Agreement over the paired days. Under `AGREEMENT_MINIMUM` pairs the counts
 * and means stand but the spread, limits and correlation are null.
 */
export const sourceAgreement = (
  a: readonly DayReading[],
  b: readonly DayReading[],
): SourceAgreement => {
  const pairs = pairByDay(a, b);
  const enough = pairs.length >= AGREEMENT_MINIMUM;
  const as = pairs.map((pair) => pair.a);
  const bs = pairs.map((pair) => pair.b);
  const differences = pairs.map((pair) => pair.b - pair.a);
  const meanDifference = pairs.length === 0 ? null : mean(differences);
  const sd = enough ? sampleSd(differences) : null;
  return {
    n_pairs: pairs.length,
    first_day: pairs.at(0)?.day ?? null,
    last_day: pairs.at(-1)?.day ?? null,
    mean_a: pairs.length === 0 ? null : mean(as),
    mean_b: pairs.length === 0 ? null : mean(bs),
    mean_difference: meanDifference,
    sd_difference: sd,
    limits_of_agreement:
      sd === null || meanDifference === null
        ? null
        : { low: meanDifference - 1.96 * sd, high: meanDifference + 1.96 * sd },
    pearson_r: enough ? pearson(as, bs) : null,
  };
};
