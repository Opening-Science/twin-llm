import { describe, expect, test } from "bun:test";

import { mulberry32 } from "@/infrastructure/seeded-random";
import { turningPoints } from "@/packages/query-tools/stats";

import {
  quantiseIntervals,
  RR_GRIDS_MS,
  tiedNeighbourShare,
  turningPointsNonStrict,
  turningPointsTiesBroken,
} from "./rr-grid";

describe("quantiseIntervals", () => {
  test("0 leaves the intervals as they are", () => {
    expect(quantiseIntervals([801, 803, 650], 0)).toEqual([801, 803, 650]);
  });

  test("4 ms: beat times on the grid, so intervals are multiples of 4 that add up", () => {
    const rr = [801, 803, 650, 702, 699];
    const out = quantiseIntervals(rr, 4);
    expect(out).toEqual([800, 804, 652, 700, 700]);
    expect(out.every((value) => value % 4 === 0)).toBe(true);
    expect(
      Math.abs(out.reduce((a, b) => a + b) - rr.reduce((a, b) => a + b)),
    ).toBeLessThan(2);
  });

  test("128 Hz: whole-ms roundings of multiples of 7.8125, like the database intervals", () => {
    const out = quantiseIntervals([800, 805, 640], RR_GRIDS_MS.ltafdb);
    // Beat times 0, 800, 1605, 2245 ms are samples 0, 102, 205, 287.
    expect(out).toEqual([797, 805, 641]);
    expect(RR_GRIDS_MS.ltafdb).toBe(7.8125);
  });

  test("nearby intervals become ties", () => {
    expect(tiedNeighbourShare(quantiseIntervals([700, 701, 702, 703], 0))).toBe(0);
    expect(
      tiedNeighbourShare(quantiseIntervals([700, 701, 702, 703], 8)),
    ).toBeGreaterThan(0);
  });

  test("a negative or non-finite grid throws", () => {
    expect(() => quantiseIntervals([800], -1)).toThrow("RR grid");
    expect(() => quantiseIntervals([800], Number.NaN)).toThrow("RR grid");
  });
});

describe("tiedNeighbourShare", () => {
  test("share of equal successive pairs", () => {
    expect(tiedNeighbourShare([1, 1, 2, 2, 3])).toBe(0.5);
    expect(tiedNeighbourShare([1])).toBe(null);
  });
});

describe("turning points and ties", () => {
  test("without ties all three counts agree", () => {
    const values = [5, 3, 8, 1, 9, 2, 7];
    const strict = turningPoints(values);
    expect(strict).toBe(5);
    expect(turningPointsNonStrict(values)).toBe(strict);
    expect(turningPointsTiesBroken(values, mulberry32(1))).toBe(strict);
  });

  test("a tie blocks strict turning points; non-strict counts them; random breaking sits between", () => {
    const values = [1, 3, 3, 1];
    expect(turningPoints(values)).toBe(0);
    expect(turningPointsNonStrict(values)).toBe(2);
    expect(turningPointsTiesBroken(values, mulberry32(1))).toBe(1);
    expect(turningPointsNonStrict([2, 2, 2])).toBe(1);
  });

  test("random breaking of a rounded continuous series gives the continuous count on average", () => {
    const random = mulberry32(7);
    const continuous = Array.from({ length: 4000 }, () => random());
    const rounded = continuous.map((value) => Math.round(value * 20));
    expect(turningPoints(rounded)).toBeLessThan(turningPoints(continuous) * 0.97);
    const broken = turningPointsTiesBroken(rounded, mulberry32(3));
    expect(Math.abs(broken / turningPoints(continuous) - 1)).toBeLessThan(0.03);
  });
});
