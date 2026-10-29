import { describe, expect, test } from "bun:test";

import { type DistanceTable } from "./benchmark";
import { distanceOf } from "./distance";
import { fixed, largestGaps, withCi } from "./report";

describe("number formatting", () => {
  test("fixed and n/a", () => {
    expect(fixed(0.12345)).toBe("0.123");
    expect(fixed(0.5, 2)).toBe("0.50");
    expect(fixed(null)).toBe("n/a");
  });

  test("an estimate with its interval", () => {
    expect(withCi({ value: 0.9, ci95: { low: 0.85, high: 0.95 } })).toBe(
      "0.900 [0.850, 0.950]",
    );
    expect(withCi({ value: 0.9, ci95: { low: null, high: null } })).toBe("0.900");
    expect(withCi({ value: null, ci95: { low: null, high: null } })).toBe("n/a");
  });
});

describe("largestGaps", () => {
  test("noise none only, largest KS first", () => {
    const tables: DistanceTable[] = [
      {
        noise: "none",
        simClass: "af",
        realClass: "AFIB",
        distances: [
          distanceOf("rr_ms", [1, 2], [1, 2]),
          distanceOf("nrmssd", [1, 2], [3, 4]),
        ],
      },
      {
        noise: "heavy",
        simClass: "af",
        realClass: "AFIB",
        distances: [distanceOf("drr_ms", [1], [9])],
      },
    ];
    expect(largestGaps(tables, 5).map((gap) => [gap.quantity, gap.ks])).toEqual([
      ["nrmssd", 1],
      ["rr_ms", 0],
    ]);
  });
});
