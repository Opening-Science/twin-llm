import { describe, expect, test } from "bun:test";

import { binFill, binIndex, binMix, legendBins, quantileBreaks } from "./color-scale";

describe("quantileBreaks", () => {
  test("splits ten values into five bins of two", () => {
    expect(
      quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map(
        (v) => Math.round(v * 1e9) / 1e9,
      ),
    ).toEqual([2.8, 4.6, 6.4, 8.2]);
  });

  test("merges repeated bounds", () => {
    expect(quantileBreaks([1, 1, 1, 1, 5]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual(
      [1, 1.8],
    );
  });

  test("drops a bound equal to the largest value", () => {
    expect(quantileBreaks([1, 5, 5, 5, 5]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual(
      [4.2],
    );
  });

  test("has no bounds for one value or all equal values", () => {
    expect(quantileBreaks([4])).toEqual([]);
    expect(quantileBreaks([3, 3, 3])).toEqual([]);
  });

  test("ignores non-finite values and honours the bin count", () => {
    expect(quantileBreaks([0, Number.NaN, 10], 2)).toEqual([5]);
  });
});

describe("binIndex", () => {
  test("a value on a bound falls in the lower bin", () => {
    expect(binIndex(2, [2, 5])).toBe(0);
    expect(binIndex(3, [2, 5])).toBe(1);
    expect(binIndex(9, [2, 5])).toBe(2);
  });

  test("with no bounds everything is bin 0", () => {
    expect(binIndex(7, [])).toBe(0);
  });
});

describe("binMix and binFill", () => {
  test("steps from 25% to 100% of chart-1", () => {
    expect([0, 1, 2, 3, 4].map((index) => binMix(index, 5))).toEqual([
      25, 44, 63, 81, 100,
    ]);
    expect(binMix(0, 1)).toBe(100);
  });

  test("mixes in OKLCH against the card so both themes work", () => {
    expect(binFill(4, 5)).toBe("color-mix(in oklch, var(--chart-1) 100%, var(--card))");
  });
});

describe("legendBins", () => {
  test("labels each bin by the values in it and skips empty bins", () => {
    expect(legendBins([1, 2, 9], [2, 5])).toEqual([
      {
        index: 0,
        from: 1,
        to: 2,
        fill: "color-mix(in oklch, var(--chart-1) 25%, var(--card))",
      },
      {
        index: 2,
        from: 9,
        to: 9,
        fill: "color-mix(in oklch, var(--chart-1) 100%, var(--card))",
      },
    ]);
  });
});
