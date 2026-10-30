import { describe, expect, test } from "bun:test";

import {
  binomialCdf,
  exactRateRatio,
  mantelHaenszelRateRatio,
  poissonCdf,
  poissonExactCi,
  rateOf,
  rateRatio,
} from "./poisson";

describe("poissonCdf", () => {
  test("matches hand values", () => {
    expect(poissonCdf(0, 1)).toBeCloseTo(Math.exp(-1), 12);
    expect(poissonCdf(2, 2)).toBeCloseTo(5 * Math.exp(-2), 12);
    expect(poissonCdf(-1, 3)).toBe(0);
    expect(poissonCdf(4, 0)).toBe(1);
  });

  test("stays finite for a large count", () => {
    expect(poissonCdf(5000, 5000)).toBeCloseTo(0.5038, 3);
  });
});

describe("poissonExactCi", () => {
  test("k = 0 gives 0 to 3.689", () => {
    const ci = poissonExactCi(0);
    expect(ci.low).toBe(0);
    expect(ci.high).toBeCloseTo(3.6889, 3);
  });

  test("k = 1 and k = 10 match published tables", () => {
    const one = poissonExactCi(1);
    expect(one.low).toBeCloseTo(0.0253, 3);
    expect(one.high).toBeCloseTo(5.5716, 3);
    const ten = poissonExactCi(10);
    expect(ten.low).toBeCloseTo(4.7954, 3);
    expect(ten.high).toBeCloseTo(18.3904, 3);
  });
});

describe("rateOf", () => {
  test("10 events in 200 person-years is 5 per 100", () => {
    const rate = rateOf(10, 200);
    expect(rate.per100).toBe(5);
    expect(rate.ci?.low).toBeCloseTo(2.3977, 3);
    expect(rate.ci?.high).toBeCloseTo(9.1952, 3);
  });

  test("no person-time gives no rate", () => {
    expect(rateOf(0, 0)).toEqual({ events: 0, personYears: 0, per100: null, ci: null });
  });
});

describe("rateRatio", () => {
  test("20 per 100 py against 10 per 100 py is 2 with a log-scale interval", () => {
    const ratio = rateRatio(rateOf(20, 100), rateOf(10, 100));
    expect(ratio?.ratio).toBe(2);
    expect(ratio?.ci.low).toBeCloseTo(2 * Math.exp(-1.959964 * Math.sqrt(0.15)), 9);
    expect(ratio?.ci.high).toBeCloseTo(2 * Math.exp(1.959964 * Math.sqrt(0.15)), 9);
  });

  test("a side with no events gives null", () => {
    expect(rateRatio(rateOf(0, 100), rateOf(10, 100))).toBeNull();
  });
});

describe("binomialCdf", () => {
  test("matches hand values and the edges", () => {
    expect(binomialCdf(3, 15, 0.3)).toBeCloseTo(0.29687, 4);
    expect(binomialCdf(0, 4, 0.5)).toBeCloseTo(1 / 16, 12);
    expect(binomialCdf(-1, 4, 0.5)).toBe(0);
    expect(binomialCdf(4, 4, 0.5)).toBe(1);
    expect(binomialCdf(2, 4, 1)).toBe(0);
  });

  test("stays finite for a large n", () => {
    expect(binomialCdf(1000, 2000, 0.5)).toBeCloseTo(0.5089, 3);
  });
});

describe("exactRateRatio", () => {
  test("10 against 10 events in equal time gives the Clopper-Pearson limits", () => {
    const result = exactRateRatio(rateOf(10, 1), rateOf(10, 1));
    expect(result?.ratio).toBeCloseTo(1, 12);
    expect(result?.ci.low).toBeCloseTo(0.272 / 0.728, 2);
    expect(result?.ci.high).toBeCloseTo(0.728 / 0.272, 2);
  });

  test("person-time scales the ratio and its limits", () => {
    const even = exactRateRatio(rateOf(10, 1), rateOf(10, 1));
    const scaled = exactRateRatio(rateOf(10, 1), rateOf(10, 2));
    expect(scaled?.ratio).toBeCloseTo(2, 12);
    expect(scaled?.ci.low).toBeCloseTo(2 * (even?.ci.low ?? 0), 6);
  });

  test("no events on the a side gives 0 with a finite upper limit", () => {
    const result = exactRateRatio(rateOf(0, 1), rateOf(5, 1));
    expect(result?.ratio).toBe(0);
    expect(result?.ci.low).toBe(0);
    const p = 1 - 0.025 ** (1 / 5);
    expect(result?.ci.high).toBeCloseTo(p / (1 - p), 4);
  });

  test("null without events or person-time on the b side", () => {
    expect(exactRateRatio(rateOf(3, 1), rateOf(0, 1))).toBeNull();
    expect(exactRateRatio(rateOf(3, 1), rateOf(2, 0))).toBeNull();
  });
});

describe("mantelHaenszelRateRatio", () => {
  test("one stratum gives the crude ratio", () => {
    const pooled = mantelHaenszelRateRatio([
      { aEvents: 20, aYears: 100, bEvents: 10, bYears: 100 },
    ]);
    expect(pooled?.ratio).toBeCloseTo(2, 12);
    const wald = rateRatio(rateOf(20, 100), rateOf(10, 100));
    expect(pooled?.ci.low).toBeCloseTo(wald?.ci.low ?? 0, 6);
    expect(pooled?.ci.high).toBeCloseTo(wald?.ci.high ?? 0, 6);
  });

  test("removes confounding by a stratum where the crude ratio does not", () => {
    // Same ratio 2 in each stratum; a's time sits mostly in the high-rate stratum.
    const strata = [
      { aEvents: 2, aYears: 100, bEvents: 9, bYears: 900 },
      { aEvents: 90, aYears: 900, bEvents: 5, bYears: 100 },
    ];
    expect(mantelHaenszelRateRatio(strata)?.ratio).toBeCloseTo(2, 6);
    const crude = rateRatio(rateOf(92, 1000), rateOf(14, 1000));
    expect(crude?.ratio).toBeGreaterThan(6);
  });

  test("strata with time on one side only add nothing; null with nothing", () => {
    expect(
      mantelHaenszelRateRatio([
        { aEvents: 20, aYears: 100, bEvents: 10, bYears: 100 },
        { aEvents: 5, aYears: 10, bEvents: 0, bYears: 0 },
      ])?.ratio,
    ).toBeCloseTo(2, 12);
    expect(
      mantelHaenszelRateRatio([{ aEvents: 0, aYears: 1, bEvents: 1, bYears: 1 }]),
    ).toBeNull();
  });
});
