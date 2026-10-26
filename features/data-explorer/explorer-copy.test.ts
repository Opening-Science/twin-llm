import { describe, expect, test } from "bun:test";

import { SYNTHETIC_COHORTS } from "@/packages/query-tools/scope";

import { COHORT_ROLES, NO_COHORT_COMMANDS, NO_COHORT_TITLE } from "./explorer-copy";

describe("empty warehouse", () => {
  test("says what is missing and gives the one setup command first", () => {
    expect(NO_COHORT_TITLE).toBe("No synthetic cohort loaded on this machine");
    expect(NO_COHORT_COMMANDS).toEqual([
      "bun run setup:local",
      "",
      "# or the 10,000-person release (about 1 GB download, 45 GB free disk):",
      "bun run setup:local -- --cohort-10k",
    ]);
  });

  test("every named cohort the setup can load has a role line", () => {
    const named = SYNTHETIC_COHORTS.filter((id) => !/^synthea-v4-seed1\d{3}$/.test(id));
    expect(named.filter((id) => COHORT_ROLES[id] === undefined)).toEqual([]);
  });
});
