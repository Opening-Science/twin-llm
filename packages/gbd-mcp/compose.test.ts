import { describe, expect, test } from "bun:test";

import { composeGbdQuestion } from "./compose";
import { gbdPopulationInput } from "./input";

describe("composeGbdQuestion", () => {
  test("template is byte-stable for a fixed tuple", () => {
    const input = gbdPopulationInput.parse({
      measure: "deaths",
      sex: "both",
      age: "age_standardized",
      year: "2021",
      location: "Global",
      cause: "All causes",
    });
    expect(composeGbdQuestion(input)).toBe(
      "IHME GBD population estimate: measure=deaths; cause=All causes; location=Global; year=2021; sex=both; age=age_standardized.",
    );
  });
});
