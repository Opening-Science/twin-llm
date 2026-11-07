import { describe, expect, test } from "bun:test";

import { SYNTHETIC_COHORTS } from "@/packages/query-tools/scope";

import * as copy from "./explorer-copy";
import { COHORT_ROLES, NO_COHORT_BODY, NO_COHORT_TITLE } from "./explorer-copy";

describe("empty warehouse", () => {
  test("says what is missing and who can load it, in plain words (#480)", () => {
    expect(NO_COHORT_TITLE).toBe("No synthetic cohort loaded on this machine");
    expect(NO_COHORT_BODY).toBe(
      "No synthetic people are loaded here yet, so there is nothing to show. Whoever runs TwinLLM here can load them: the 30-person evaluation cohort comes out the same on every machine.",
    );
  });

  test("no Data page sentence names a command, an env variable or an internal word", () => {
    const sentences = Object.values(copy).flatMap((value) =>
      typeof value === "string"
        ? [value]
        : typeof value === "object" && value !== null
          ? Object.values(value).filter((item) => typeof item === "string")
          : [],
    );
    expect(
      sentences.filter((text) =>
        /bun run|DATA_MODE|\.env|warehouse|allowlist|subject_ref/.test(text),
      ),
    ).toEqual([]);
  });

  test("every named cohort the setup can load has a role line", () => {
    const named = SYNTHETIC_COHORTS.filter((id) => !/^synthea-v4-seed1\d{3}$/.test(id));
    expect(named.filter((id) => COHORT_ROLES[id] === undefined)).toEqual([]);
  });
});
