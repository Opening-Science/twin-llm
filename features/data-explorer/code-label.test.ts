import { describe, expect, test } from "bun:test";

import { codeKind, isLoincCode } from "./code-label";

describe("codeKind", () => {
  test("LOINC codes keep their name", () => {
    for (const code of ["8302-2", "29463-7", "85354-9", "4548-4", "103213-5"]) {
      expect(isLoincCode(code)).toBe(true);
      expect(codeKind(code)).toBe("LOINC");
    }
  });

  test("scan paths and the synthetic wearables' own codes are plain codes", () => {
    for (const code of [
      "body.height",
      "body.bmi",
      "af-burden",
      "spo2-min",
      "irregular-rhythm-notification",
      "85354-9#8480-6",
      "",
    ]) {
      expect(isLoincCode(code)).toBe(false);
      expect(codeKind(code)).toBe("Code");
    }
  });
});
