import { describe, expect, test } from "bun:test";

import {
  isAllowedCohort,
  SYNTHEA_1M_COHORTS,
  SYNTHETIC_COHORTS,
  type SyntheticCohortId,
} from "./scope";

describe("cohort allowlist", () => {
  test("the 1M batches are seeds 1001 to 1100, after the named cohorts", () => {
    expect(SYNTHETIC_COHORTS.slice(0, 8)).toEqual([
      "open-twin-synthea-trimmed-3",
      "synthea-v4-seed42",
      "synthea-v4-seed4242",
      "synthea-v4-seed9001",
      "synthea-v4-seed42-10k",
      "synthea-v4-s7",
      "synthea-v4-1m-af",
      "synthea-v4-seed1001",
    ]);
    expect(SYNTHEA_1M_COHORTS).toEqual(
      Array.from({ length: 100 }, (_, index) => `synthea-v4-seed${1001 + index}`),
    );
    expect(SYNTHETIC_COHORTS.length).toBe(107);
  });

  test("isAllowedCohort takes a batch and nothing next to the range", () => {
    expect(isAllowedCohort("synthea-v4-seed1001")).toBe(true);
    expect(isAllowedCohort("synthea-v4-seed1100")).toBe(true);
    expect(isAllowedCohort("synthea-v4-seed1000")).toBe(false);
    expect(isAllowedCohort("synthea-v4-seed1101")).toBe(false);
    expect(isAllowedCohort("synthea-v4-seed01001")).toBe(false);
  });

  test("the cohort type is exactly the listed ids", () => {
    const batch: SyntheticCohortId = "synthea-v4-seed1050";
    // @ts-expect-error seed 1000 is not a batch
    const before: SyntheticCohortId = "synthea-v4-seed1000";
    // @ts-expect-error seed 1101 is not a batch
    const after: SyntheticCohortId = "synthea-v4-seed1101";
    expect([batch, before, after]).toEqual([
      "synthea-v4-seed1050",
      "synthea-v4-seed1000",
      "synthea-v4-seed1101",
    ]);
  });
});
