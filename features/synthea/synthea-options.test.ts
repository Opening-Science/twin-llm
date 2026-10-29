import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SYNTHEA_OPTIONS,
  parseSyntheaOptions,
  SYNTHEA_MODULE_KEYS,
  SYNTHEA_STATES,
} from "./synthea-options";

const valid = {
  people: 3,
  seed: 7,
  ageMin: 40,
  ageMax: 60,
  sex: "female",
  state: "Texas",
  modules: ["asthma", "hypertension"],
  formats: ["fhir", "csv"],
};

const message = (body: unknown, max = 50): string => {
  const parsed = parseSyntheaOptions(body, max);
  return parsed.ok ? "ok" : parsed.message;
};

describe("parseSyntheaOptions", () => {
  test("accepts a request built from the page's choices", () => {
    expect(parseSyntheaOptions(valid, 50)).toEqual({ ok: true, options: valid });
    expect(parseSyntheaOptions(DEFAULT_SYNTHEA_OPTIONS, 50)).toEqual({
      ok: true,
      options: DEFAULT_SYNTHEA_OPTIONS,
    });
  });

  test("holds the people cap the server passes", () => {
    expect(message({ ...valid, people: 51 })).toBe(
      "This server makes at most 50 people per run",
    );
    expect(message({ ...valid, people: 51 }, 100)).toBe("ok");
    expect(message({ ...valid, people: 0 })).toBe("Ask for at least 1 person");
    expect(message({ ...valid, people: 2.5 })).toBe(
      "Some options are not ones this page offers. Reload the page and try again.",
    );
  });

  test("refuses ages the wrong way round", () => {
    expect(message({ ...valid, ageMin: 70, ageMax: 30 })).toBe(
      "The lowest age must not be above the highest",
    );
  });

  test("refuses anything outside the closed lists", () => {
    const refused =
      "Some options are not ones this page offers. Reload the page and try again.";
    expect(message({ ...valid, state: "Texas; rm -rf /" })).toBe(refused);
    expect(message({ ...valid, state: "Bavaria" })).toBe(refused);
    expect(message({ ...valid, modules: ["asthma*"] })).toBe(refused);
    expect(message({ ...valid, modules: ["../../etc/passwd"] })).toBe(refused);
    expect(message({ ...valid, formats: ["ccda"] })).toBe(refused);
    expect(message({ ...valid, sex: "F" })).toBe(refused);
    expect(message({ ...valid, seed: "7" })).toBe(refused);
    expect(message({ ...valid, seed: -1 })).toBe(refused);
    expect(message({ ...valid, ageMax: 101 })).toBe(refused);
    expect(message({ ...valid, extra: "--exporter.baseDirectory=/" })).toBe(refused);
    expect(message("people=3")).toBe(refused);
    expect(message(null)).toBe(refused);
  });

  test("refuses empty or repeated lists", () => {
    expect(message({ ...valid, formats: [] })).toBe("Pick at least one output format");
    expect(message({ ...valid, formats: ["fhir", "fhir"] })).toBe("Each format once");
    expect(message({ ...valid, modules: ["copd", "copd"] })).toBe("Each module once");
  });

  test("offers 51 places and 10 modules", () => {
    expect(SYNTHEA_STATES.length).toBe(51);
    expect(SYNTHEA_MODULE_KEYS).toEqual([
      "asthma",
      "copd",
      "atrial-fibrillation",
      "heart-failure",
      "hypertension",
      "kidney-disease",
      "metabolic-syndrome",
      "dementia",
      "osteoarthritis",
      "sleep-apnea",
    ]);
  });
});
