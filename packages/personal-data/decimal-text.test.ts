import { describe, expect, test } from "bun:test";

import { parsePlainNumber, shiftDecimal } from "./decimal-text";

describe("parsePlainNumber", () => {
  test("reads plain numbers only", () => {
    expect(parsePlainNumber("5.4")).toBe(5.4);
    expect(parsePlainNumber(" -1 ")).toBe(-1);
    expect(parsePlainNumber("1e3")).toBe(1000);
    expect(parsePlainNumber("<0.5")).toBe(null);
    expect(parsePlainNumber("")).toBe(null);
    expect(parsePlainNumber("NaN")).toBe(null);
    expect(parsePlainNumber(undefined)).toBe(null);
  });
});

describe("shiftDecimal", () => {
  test("moves the decimal point without float error", () => {
    expect(shiftDecimal("0.97", 2)).toBe(97);
    expect(shiftDecimal("0.0423", 3)).toBe(42.3);
    expect(shiftDecimal("0.29", 2)).toBe(29);
    expect(shiftDecimal("1", 2)).toBe(100);
    expect(shiftDecimal("72400", -3)).toBe(72.4);
    expect(shiftDecimal("5", -3)).toBe(0.005);
    expect(shiftDecimal("-1.5", 1)).toBe(-15);
    expect(shiftDecimal(".5", 0)).toBe(0.5);
  });

  test("refuses text that is not a plain decimal", () => {
    expect(shiftDecimal("1e3", 1)).toBe(null);
    expect(shiftDecimal("", 1)).toBe(null);
    expect(shiftDecimal(".", 1)).toBe(null);
    expect(shiftDecimal("abc", 1)).toBe(null);
  });
});
