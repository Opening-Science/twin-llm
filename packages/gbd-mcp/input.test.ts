import { describe, expect, test } from "bun:test";

import { gbdPopulationInput } from "./input";

const valid = {
  measure: "deaths",
  sex: "both",
  age: "all_ages",
  year: "2021",
  location: "Switzerland",
  cause: "Cardiovascular diseases",
} as const;

describe("gbd_population input", () => {
  test("accepts one closed tuple", () => {
    expect(gbdPopulationInput.parse(valid)).toEqual(valid);
  });

  test("rejects free text", () => {
    expect(gbdPopulationInput.safeParse({ ...valid, cause: "free text" }).success).toBe(
      false,
    );
    expect(
      gbdPopulationInput.safeParse({ ...valid, question: "how many deaths?" }).success,
    ).toBe(false);
  });

  test("rejects extra keys", () => {
    expect(gbdPopulationInput.safeParse({ ...valid, extra: "nope" }).success).toBe(false);
  });

  test("rejects empty strings", () => {
    expect(gbdPopulationInput.safeParse({ ...valid, measure: "" }).success).toBe(false);
    expect(gbdPopulationInput.safeParse({ ...valid, year: "" }).success).toBe(false);
  });
});
