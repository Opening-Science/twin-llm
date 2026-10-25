import { describe, expect, test } from "bun:test";

import { guidelineSearchInput } from "./input";

describe("guidelineSearchInput", () => {
  test("defaults k to 5", () => {
    expect(guidelineSearchInput.parse({ query: "ALS NIV" })).toEqual({
      query: "ALS NIV",
      k: 5,
    });
  });

  test("rejects k above 8 and an empty query", () => {
    expect(() => guidelineSearchInput.parse({ query: "ALS", k: 9 })).toThrow();
    expect(() => guidelineSearchInput.parse({ query: "   " })).toThrow();
  });
});
