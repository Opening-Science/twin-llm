import { describe, expect, test } from "bun:test";

import { poissonCdf, poissonExactCi, rateOf, rateRatio } from "./poisson";

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
