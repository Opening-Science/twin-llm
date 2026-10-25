import { describe, expect, test } from "bun:test";

import { anchorLayer, type ReferenceInterval } from "./anchor-layer";
import { intervalPosition, type IntervalPosition } from "./interval-position";

const interval = (id: string): ReferenceInterval =>
  anchorLayer.referenceIntervals.find((row) => row.id === id)!;

// Natrium 135–145 mmol/L; CRP < 5 mg/L (open low); HDL male ≥ 40 mg/dL (open high).
const NATRIUM = interval("RI-085");
const CRP = interval("RI-031");
const HDL_MALE = interval("RI-072");
const BOR = interval("RI-017");

describe("intervalPosition", () => {
  test.each<[string, number, string, ReferenceInterval | null, IntervalPosition]>([
    ["below", 134.9, "mmol/L", NATRIUM, "below"],
    ["low bound is inside", 135, "mmol/L", NATRIUM, "within"],
    ["within", 140, "mmol/L", NATRIUM, "within"],
    ["high bound is inside", 145, "mmol/L", NATRIUM, "within"],
    ["above", 145.1, "mmol/L", NATRIUM, "above"],
    ["open low end", 0, "mg/L", CRP, "within"],
    ["open low end, at the high bound", 5, "mg/L", CRP, "within"],
    ["open low end, above", 5.1, "mg/L", CRP, "above"],
    ["open high end", 400, "mg/dL", HDL_MALE, "within"],
    ["open high end, below", 39.9, "mg/dL", HDL_MALE, "below"],
    ["UCUM is case-sensitive", 50, "mg/dl", HDL_MALE, "unknown"],
    ["no unit conversion", 3.4, "mmol/L", HDL_MALE, "unknown"],
    ["BLOCKING marker (Bor, D11)", 50, "ug/L", BOR, "unknown"],
    ["not a number", Number.NaN, "mmol/L", NATRIUM, "unknown"],
    ["infinite", Number.POSITIVE_INFINITY, "mmol/L", NATRIUM, "unknown"],
    ["no interval", 140, "mmol/L", null, "unknown"],
  ])("%s", (_name, value, unit, row, expected) => {
    expect(intervalPosition(value, unit, row)).toBe(expected);
  });

  test("an interval with neither bound gives no position", () => {
    expect(intervalPosition(1, "mmol/L", { ...NATRIUM, low: null, high: null })).toBe(
      "unknown",
    );
  });

  test("an interval without a UCUM unit gives no position", () => {
    expect(intervalPosition(140, "mmol/L", { ...NATRIUM, unitUcum: null })).toBe(
      "unknown",
    );
  });
});
