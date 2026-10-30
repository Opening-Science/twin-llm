import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { cohortCodesFrom } from "./build-cohort-codes";
import { COHORT_CODES_PATH, cohortCodesSchema } from "./cohort-codes";
import { answerKeySchema } from "./question-set";
import { isValidLoinc } from "./score/call-accuracy";

const observation = (code: string, value: number) => ({
  resource: {
    resourceType: "Observation",
    id: `obs-${code}-${value}`,
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code }] },
    valueQuantity: {
      value,
      unit: "%",
      system: "http://unitsofmeasure.org",
      code: "%",
    },
    effectiveDateTime: "2025-01-01T00:00:00Z",
  },
});

describe("cohortCodesFrom", () => {
  test("distinct LOINC codes of numeric observations, in code order", () => {
    const bundles = [
      { entry: [observation("4548-4", 6.1), observation("4548-4", 6.2)] },
      {
        entry: [
          observation("29463-7", 80),
          observation("hrv-rmssd", 41),
          { resource: { resourceType: "Patient", id: "p" } },
        ],
      },
      { entry: "not a list" },
    ];
    expect(cohortCodesFrom(bundles)).toEqual(["4548-4", "29463-7"]);
  });
});

describe(COHORT_CODES_PATH, () => {
  const file = cohortCodesSchema.parse(
    JSON.parse(readFileSync(COHORT_CODES_PATH, "utf8")) as unknown,
  );
  const key = answerKeySchema.parse(
    JSON.parse(readFileSync("evaluation/answer-key.v1.json", "utf8")) as unknown,
  );

  test("pins the cohort the answer key was built from", () => {
    expect(file.content_sha256).toBe(key.cohort.content_sha256);
  });

  test("every code has a valid check digit and appears once", () => {
    expect(file.codes.filter((code) => !isValidLoinc(code))).toEqual([]);
    expect(new Set(file.codes).size).toBe(file.codes.length);
  });

  test("every code the key read rows of is in the list", () => {
    const read = Object.values(key.entries)
      .flat()
      .filter((entry) => entry.n > 0)
      .flatMap((entry) => {
        const loinc = entry.args.loinc;
        return typeof loinc === "string" ? [loinc] : Array.isArray(loinc) ? loinc : [];
      });
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((code) => !file.codes.includes(String(code)))).toEqual([]);
  });
});
