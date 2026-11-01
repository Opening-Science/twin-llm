import { describe, expect, test } from "bun:test";

import {
  columnsForWidth,
  effectiveSpan,
  farthestCornerDistance,
  revealDelayMs,
} from "./bento-model";

describe("columnsForWidth", () => {
  test("four columns from 840px, two from 480px, one below", () => {
    expect([1200, 840, 839, 480, 479, 375, 0].map(columnsForWidth)).toEqual([
      4, 4, 2, 2, 1, 1, 1,
    ]);
  });

  test("a width that is not a number gives one column", () => {
    expect(columnsForWidth(Number.NaN)).toBe(1);
    expect(columnsForWidth(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("effectiveSpan", () => {
  test("keeps a span that fits", () => {
    expect(effectiveSpan({ cols: 2, rows: 2 }, 4)).toEqual({ cols: 2, rows: 2 });
  });

  test("clamps columns to the grid and keeps rows", () => {
    expect(effectiveSpan({ cols: 4, rows: 1 }, 2)).toEqual({ cols: 2, rows: 1 });
    expect(effectiveSpan({ cols: 3, rows: 2 }, 2)).toEqual({ cols: 2, rows: 2 });
  });

  test("one column ignores every span", () => {
    expect(effectiveSpan({ cols: 4, rows: 2 }, 1)).toEqual({ cols: 1, rows: 1 });
  });

  test("a zero, fractional or bad span becomes one whole cell", () => {
    expect(effectiveSpan({ cols: 0, rows: -1 }, 4)).toEqual({ cols: 1, rows: 1 });
    expect(effectiveSpan({ cols: 2.7, rows: 1.2 }, 4)).toEqual({ cols: 2, rows: 1 });
    expect(effectiveSpan({ cols: Number.NaN, rows: 2 }, 4)).toEqual({
      cols: 1,
      rows: 2,
    });
  });
});

describe("revealDelayMs", () => {
  test("steps 70ms per card and stops growing after the eighth", () => {
    expect([0, 1, 2, 8, 9, 30].map(revealDelayMs)).toEqual([0, 70, 140, 560, 560, 560]);
  });

  test("a negative index starts at once", () => {
    expect(revealDelayMs(-3)).toBe(0);
  });
});

describe("farthestCornerDistance", () => {
  test("reaches the opposite corner", () => {
    expect(farthestCornerDistance({ x: 0, y: 0 }, { width: 300, height: 400 })).toBe(500);
    expect(farthestCornerDistance({ x: 300, y: 400 }, { width: 300, height: 400 })).toBe(
      500,
    );
  });

  test("from the centre reaches any corner", () => {
    expect(farthestCornerDistance({ x: 150, y: 200 }, { width: 300, height: 400 })).toBe(
      250,
    );
  });
});
