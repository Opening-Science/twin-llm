import { describe, expect, test } from "bun:test";

import { isCurrentSmoker, oracleFacts } from "./oracle-facts";

const loinc = (code: string, display: string) => ({
  coding: [{ system: "http://loinc.org", code, display }],
});

const bpPanel = (id: string, at: string, systolic: number) => ({
  resource: {
    resourceType: "Observation",
    id,
    code: loinc("85354-9", "Blood pressure panel"),
    effectiveDateTime: at,
    component: [
      {
        code: loinc("8462-4", "Diastolic blood pressure"),
        valueQuantity: { value: 80, system: "http://unitsofmeasure.org", code: "mm[Hg]" },
      },
      {
        code: loinc("8480-6", "Systolic blood pressure"),
        valueQuantity: {
          value: systolic,
          system: "http://unitsofmeasure.org",
          code: "mm[Hg]",
        },
      },
    ],
  },
});

const smoking = (id: string, at: string, display: string) => ({
  resource: {
    resourceType: "Observation",
    id,
    code: loinc("72166-2", "Tobacco smoking status"),
    effectiveDateTime: at,
    valueCodeableConcept: {
      coding: [{ system: "http://snomed.info/sct", code: "x", display }],
    },
  },
});

const encounter = (id: string, start: string, code: string) => ({
  resource: {
    resourceType: "Encounter",
    id,
    type: [{ coding: [{ system: "http://snomed.info/sct", code }] }],
    period: { start, end: start },
  },
});

describe("isCurrentSmoker", () => {
  test("daily and current smokers are smokers; never and ex-smokers are not", () => {
    expect(isCurrentSmoker("Smokes tobacco daily (finding)")).toBe(true);
    expect(isCurrentSmoker("Current every day smoker")).toBe(true);
    expect(isCurrentSmoker("Never smoked tobacco (finding)")).toBe(false);
    expect(isCurrentSmoker("Ex-smoker (finding)")).toBe(false);
    expect(isCurrentSmoker("Former smoker")).toBe(false);
  });
});

describe("oracleFacts", () => {
  const facts = oracleFacts([
    bpPanel("o2", "2020-05-01T10:00:00Z", 151),
    bpPanel("o1", "2018-04-01T10:00:00Z", 128.4),
    smoking("s1", "2018-04-01T10:00:00Z", "Smokes tobacco daily (finding)"),
    smoking("s2", "2020-05-01T10:00:00Z", "Ex-smoker (finding)"),
    encounter("e1", "2018-04-01T10:00:00Z", "162673000"),
    encounter("e2", "2019-04-01T10:00:00Z", "185347001"),
    encounter("e3", "2020-05-01T10:00:00Z", "162673000"),
    encounter("e4", "2020-05-01T15:00:00Z", "162673000"),
  ]);

  test("systolic readings from the BP panel's component, oldest first", () => {
    expect(facts.systolic).toEqual([
      ["2018-04-01", 128.4],
      ["2020-05-01", 151],
    ]);
  });

  test("smoking status by day", () => {
    expect(facts.smoker).toEqual([
      ["2018-04-01", true],
      ["2020-05-01", false],
    ]);
  });

  test("wellness visit days only, once each", () => {
    expect(facts.wellness).toEqual(["2018-04-01", "2020-05-01"]);
  });

  test("a bundle with nothing usable gives empty lists", () => {
    expect(oracleFacts([{ resource: { resourceType: "Patient" } }, null])).toEqual({
      systolic: [],
      smoker: [],
      wellness: [],
    });
  });
});
