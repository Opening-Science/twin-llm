import { describe, expect, test } from "bun:test";

import { bundleFacts } from "./person-facts";

const snomed = (code: string, display: string) => ({
  coding: [{ system: "http://snomed.info/sct", code, display }],
});

const condition = (id: string, code: string, display: string, onset: string) => ({
  resource: {
    resourceType: "Condition",
    id,
    code: snomed(code, display),
    onsetDateTime: onset,
  },
});

const bundle = {
  resourceType: "Bundle",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "p1",
        gender: "female",
        birthDate: "1940-03-02",
        deceasedDateTime: "2020-05-06T10:00:00-04:00",
        name: [{ family: "Made-up" }],
      },
    },
    condition(
      "c1",
      "49436004",
      "Atrial fibrillation (disorder)",
      "2010-01-05T08:00:00-05:00",
    ),
    condition(
      "c2",
      "59621000",
      "Essential hypertension (disorder)",
      "1990-02-01T08:00:00-05:00",
    ),
    condition(
      "c3",
      "59621000",
      "Essential hypertension (disorder)",
      "1985-02-01T08:00:00-05:00",
    ),
    condition(
      "c4",
      "230690007",
      "Cerebrovascular accident (disorder)",
      "2015-07-01T12:00:00-04:00",
    ),
    condition("c5", "714628002", "Prediabetes (finding)", "1980-01-01T08:00:00-05:00"),
    {
      resource: {
        resourceType: "MedicationRequest",
        id: "m1",
        medicationCodeableConcept: {
          coding: [
            {
              system: "http://www.nlm.nih.gov/research/umls/rxnorm",
              code: "855332",
              display: "Warfarin Sodium 5 MG Oral Tablet",
            },
          ],
        },
        authoredOn: "2011-02-03T09:00:00-05:00",
      },
    },
    {
      resource: {
        resourceType: "MedicationRequest",
        id: "m2",
        medicationCodeableConcept: {
          coding: [
            {
              system: "http://www.nlm.nih.gov/research/umls/rxnorm",
              code: "855332",
              display: "warfarin sodium 5 MG Oral Tablet",
            },
          ],
        },
        authoredOn: "2010-06-03T09:00:00-04:00",
      },
    },
  ],
};

describe("bundleFacts", () => {
  test("reads birth, sex, death, first onsets and the first anticoagulant", () => {
    expect(bundleFacts(bundle, "001")).toEqual({
      person: {
        id: "p1",
        batch: "001",
        sex: "F",
        birth: "1940-03-02",
        death: "2020-05-06",
        onsets: { af: "2010-01-05", hypertension: "1985-02-01", stroke: "2015-07-01" },
        anticoagulantStart: "2010-06-03",
      },
      cerebrovascular: { "230690007|Cerebrovascular accident (disorder)": 1 },
      anticoagulants: {
        "855332|Warfarin Sodium 5 MG Oral Tablet": 1,
        "855332|warfarin sodium 5 MG Oral Tablet": 1,
      },
    });
  });

  test("a bundle without a Patient gives null", () => {
    expect(bundleFacts({ resourceType: "Bundle", entry: [] }, "001")).toBeNull();
    expect(bundleFacts("nope", "001")).toBeNull();
  });

  test("a living man with nothing recorded", () => {
    const facts = bundleFacts(
      {
        entry: [
          {
            resource: {
              resourceType: "Patient",
              id: "p2",
              gender: "male",
              birthDate: "2001-01-01",
            },
          },
        ],
      },
      "002",
    );
    expect(facts?.person).toEqual({
      id: "p2",
      batch: "002",
      sex: "M",
      birth: "2001-01-01",
      death: null,
      onsets: {},
      anticoagulantStart: null,
    });
  });
});
