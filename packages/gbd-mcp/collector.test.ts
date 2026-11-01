import { beforeEach, describe, expect, test } from "bun:test";

import { drainGbdTurn, recordGbdRows, resetGbdCollectorForTests } from "./collector";

const ROW = {
  measure: "deaths",
  cause: "Cardiovascular diseases",
  location: "Switzerland",
  year: "2021",
  sex: "both",
  age: "age_standardized",
  value: 100.5,
  lower: 90.75,
  upper: 110.25,
  unit: "rate",
  source: "IHME GBD 2023",
} as const;

describe("recordGbdRows", () => {
  beforeEach(resetGbdCollectorForTests);

  test("adds local store rows to the turn without a remote source", () => {
    recordGbdRows("turn-a", [ROW]);
    recordGbdRows("turn-a", [{ ...ROW, year: "2023" }]);
    expect(drainGbdTurn("turn-a")).toEqual({
      sources: [],
      rows: [ROW, { ...ROW, year: "2023" }],
    });
    expect(drainGbdTurn("turn-a")).toEqual({ sources: [], rows: [] });
  });
});
