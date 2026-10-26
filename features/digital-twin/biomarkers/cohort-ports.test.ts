import { describe, expect, test } from "bun:test";

import {
  DEMO_COHORTS,
  SYNTHEA_1M_COHORTS,
  SYNTHETIC_COHORTS,
} from "@/packages/query-tools/scope";

import { DEMO_SUBJECT_WHERE } from "@/packages/query-tools/synthetic-display";

import { demoSubjectOnly } from "./cohort-ports";

describe("Demo cohorts", () => {
  test("lists the fixtures and the evaluation cohort, never training or held-out", () => {
    expect(DEMO_SUBJECT_WHERE).toEqual({
      isSynthetic: true,
      cohortId: { in: ["open-twin-synthea-trimmed-3", "synthea-v4-seed42"] },
    });
    expect(
      SYNTHETIC_COHORTS.filter((id) => !(DEMO_COHORTS as readonly string[]).includes(id)),
    ).toEqual([
      "synthea-v4-seed4242",
      "synthea-v4-seed9001",
      "synthea-v4-seed42-10k",
      ...SYNTHEA_1M_COHORTS,
    ]);
  });

  test("a training or held-out subject reads as unknown", () => {
    const row = (cohortId: string) => ({ isSynthetic: true, cohortId });
    expect(demoSubjectOnly(row("synthea-v4-seed42"))).toEqual(row("synthea-v4-seed42"));
    expect(demoSubjectOnly(row("synthea-v4-seed4242"))).toBeNull();
    expect(demoSubjectOnly(row("synthea-v4-seed9001"))).toBeNull();
    expect(demoSubjectOnly(row("synthea-v4-seed1001"))).toBeNull();
    expect(
      demoSubjectOnly({ isSynthetic: false, cohortId: "synthea-v4-seed42" }),
    ).toBeNull();
    expect(demoSubjectOnly(null)).toBeNull();
  });
});
