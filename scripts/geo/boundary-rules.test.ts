import { describe, expect, test } from "bun:test";

import { admin0Code, GBD_SUBNATIONAL, splitAltNames } from "./boundary-rules";
import { mergeByCode } from "./merge-units";

describe("admin0Code", () => {
  test("prefers ISO_A3, then ISO_A3_EH, then ADM0_A3", () => {
    expect(admin0Code({ ISO_A3: "NGA", ISO_A3_EH: "XXX", ADM0_A3: "YYY" })).toBe("NGA");
    expect(admin0Code({ ISO_A3: "-99", ISO_A3_EH: "FRA", ADM0_A3: "FRA" })).toBe("FRA");
    expect(admin0Code({ ISO_A3: "-99", ISO_A3_EH: "-99", ADM0_A3: "KOS" })).toBe("KOS");
    expect(admin0Code({ ISO_A3: null, ISO_A3_EH: null, ADM0_A3: null })).toBeNull();
  });
});

describe("splitAltNames", () => {
  test("splits on bars and drops blanks", () => {
    expect(splitAltNames("Lagos State| Eko |")).toEqual(["Lagos State", "Eko"]);
    expect(splitAltNames(null)).toEqual([]);
  });
});

describe("GBD_SUBNATIONAL", () => {
  test("lists 22 distinct ISO3 codes", () => {
    expect(new Set(GBD_SUBNATIONAL).size).toBe(22);
    expect(GBD_SUBNATIONAL.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
  });
});

describe("mergeByCode", () => {
  const ring = (size: number) =>
    [
      [0, 0],
      [0, size],
      [size, size],
      [0, 0],
    ] as const;

  test("joins units of one code under the largest unit's names", () => {
    expect(
      mergeByCode([
        {
          code: "AUS",
          name: "Islands",
          names: ["Islands"],
          label: [1, 1],
          rings: [ring(1)],
        },
        { code: "NZL", name: "NZ", names: ["NZ"], label: [2, 2], rings: [ring(2)] },
        {
          code: "AUS",
          name: "Australia",
          names: ["Australia"],
          label: [3, 3],
          rings: [ring(5)],
        },
      ]),
    ).toEqual([
      {
        code: "AUS",
        name: "Australia",
        names: ["Australia"],
        label: [3, 3],
        rings: [ring(1), ring(5)],
      },
      { code: "NZL", name: "NZ", names: ["NZ"], label: [2, 2], rings: [ring(2)] },
    ]);
  });
});
