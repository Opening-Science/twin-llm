import { describe, expect, test } from "bun:test";

import { pairByDay, sourceAgreement } from "./source-agreement";
import type { DayReading, RowSource } from "./wearable-readings";

const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}`;
const series = (source: RowSource, values: Record<number, number>): DayReading[] =>
  Object.entries(values).map(([n, value]) => ({
    source,
    day: day(Number(n)),
    at: new Date(`${day(Number(n))}T00:00:00.000Z`),
    value,
    unit: "ms",
  }));

describe("pairByDay", () => {
  test("keeps only days both sources recorded, oldest first", () => {
    const a = series("oura", { 3: 40, 1: 42, 2: 44 });
    const b = series("whoop", { 2: 50, 3: 47, 4: 60 });
    expect(pairByDay(a, b)).toEqual([
      { day: day(2), a: 44, b: 50 },
      { day: day(3), a: 40, b: 47 },
    ]);
  });
});

describe("sourceAgreement", () => {
  // Oura 40..46, Whoop reads 5 higher on even days and 3 higher on odd days.
  const oura = series("oura", { 1: 40, 2: 41, 3: 42, 4: 43, 5: 44, 6: 45, 7: 46 });
  const whoop = series("whoop", { 1: 43, 2: 46, 3: 45, 4: 48, 5: 47, 6: 50, 7: 49 });

  test("mean difference, spread, limits and correlation by hand", () => {
    // Differences b − a: 3,5,3,5,3,5,3 → mean 27/7.
    const result = sourceAgreement(oura, whoop);
    expect(result.n_pairs).toBe(7);
    expect(result.first_day).toBe(day(1));
    expect(result.last_day).toBe(day(7));
    expect(result.mean_a).toBe(43);
    expect(result.mean_b).toBeCloseTo(46.857142857, 9);
    expect(result.mean_difference).toBeCloseTo(27 / 7, 12);
    // Squared deviations from 27/7: four 3s (6/7)^2 and three 5s (8/7)^2 → 336/49; /6 → 8/7.
    const sd = Math.sqrt(8 / 7);
    expect(result.sd_difference).toBeCloseTo(sd, 12);
    expect(result.limits_of_agreement?.low).toBeCloseTo(27 / 7 - 1.96 * sd, 12);
    expect(result.limits_of_agreement?.high).toBeCloseTo(27 / 7 + 1.96 * sd, 12);
    // sxx = 28 and sxy = 28 (the differences do not track a); syy = 28 + 48/7.
    expect(result.pearson_r).toBeCloseTo(Math.sqrt(28 / (28 + 48 / 7)), 12);
  });

  test("under 7 paired days: counts and means, no spread or correlation", () => {
    const result = sourceAgreement(oura.slice(0, 3), whoop.slice(0, 3));
    expect(result.n_pairs).toBe(3);
    expect(result.mean_difference).toBeCloseTo(11 / 3, 12);
    expect(result.sd_difference).toBeNull();
    expect(result.limits_of_agreement).toBeNull();
    expect(result.pearson_r).toBeNull();
  });

  test("no shared days: everything null, never zero", () => {
    expect(sourceAgreement(oura, series("whoop", { 20: 50 }))).toEqual({
      n_pairs: 0,
      first_day: null,
      last_day: null,
      mean_a: null,
      mean_b: null,
      mean_difference: null,
      sd_difference: null,
      limits_of_agreement: null,
      pearson_r: null,
    });
  });

  test("a side that never varies has no correlation", () => {
    const flat = series("whoop", { 1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 50, 7: 50 });
    expect(sourceAgreement(oura, flat).pearson_r).toBeNull();
  });
});
