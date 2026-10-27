import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mapConditions, mapMedicationRequests } from "./map-clinical";

const FIXTURE = join(
  import.meta.dir,
  "../../tests/fixtures/synthea/clinical/clinical-records.json",
);

const entries = (): readonly unknown[] =>
  (JSON.parse(readFileSync(FIXTURE, "utf8")) as { entry: unknown[] }).entry;

const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";

describe("mapConditions", () => {
  test("copies code, dates, statuses and the encounter ref as recorded", () => {
    expect(mapConditions(entries())).toEqual([
      {
        fhirId: "c1000000-0000-4000-8000-000000000003",
        codeSystem: "http://snomed.info/sct",
        code: "444814009",
        display: "Viral sinusitis (disorder)",
        onsetAt: new Date("2015-04-02T09:00:00.000Z"),
        abatementAt: new Date("2015-04-20T09:00:00.000Z"),
        clinicalStatus: "resolved",
        verificationStatus: "confirmed",
        encounterRef: "urn:uuid:c1000000-0000-4000-8000-000000000002",
      },
      {
        fhirId: "c1000000-0000-4000-8000-000000000004",
        codeSystem: "http://hl7.org/fhir/sid/icd-10",
        code: "I10",
        display: "Essential (primary) hypertension",
        onsetAt: new Date("2018-11-05T10:00:00.000Z"),
        abatementAt: null,
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        encounterRef: null,
      },
    ]);
  });

  test("a missing date or status stays null, never invented", () => {
    expect(
      mapConditions([
        {
          resource: {
            resourceType: "Condition",
            id: "c-bare",
            code: { text: "Only text" },
            onsetDateTime: "not a date",
          },
        },
        { resource: { resourceType: "Condition" } },
      ]),
    ).toEqual([
      {
        fhirId: "c-bare",
        codeSystem: "",
        code: "",
        display: "Only text",
        onsetAt: null,
        abatementAt: null,
        clinicalStatus: null,
        verificationStatus: null,
        encounterRef: null,
      },
    ]);
  });
});

describe("mapMedicationRequests", () => {
  test("reads the code from the concept or the referenced Medication; dosage text only as recorded", () => {
    expect(mapMedicationRequests(entries())).toEqual([
      {
        fhirId: "c1000000-0000-4000-8000-000000000005",
        codeSystem: RXNORM,
        code: "313782",
        display: "Acetaminophen 325 MG Oral Tablet",
        authoredAt: new Date("2015-04-02T09:20:00.000Z"),
        status: "completed",
        intent: "order",
        dosageText: ["Take as needed."],
        reasonRefs: ["urn:uuid:c1000000-0000-4000-8000-000000000003"],
      },
      {
        fhirId: "c1000000-0000-4000-8000-000000000007",
        codeSystem: RXNORM,
        code: "314076",
        display: "lisinopril 10 MG Oral Tablet",
        authoredAt: new Date("2018-11-05T10:15:00.000Z"),
        status: "active",
        intent: "order",
        dosageText: [],
        reasonRefs: ["urn:uuid:c1000000-0000-4000-8000-000000000004"],
      },
    ]);
  });

  test("an RxNorm coding wins; an unresolved Medication leaves the code empty", () => {
    expect(
      mapMedicationRequests([
        {
          resource: {
            resourceType: "MedicationRequest",
            id: "m-two-codings",
            status: "stopped",
            medicationCodeableConcept: {
              coding: [
                { system: "http://example.org/local", code: "X1", display: "Local" },
                {
                  system: RXNORM,
                  code: "197361",
                  display: "amLODIPine 5 MG Oral Tablet",
                },
              ],
            },
            dosageInstruction: [{ text: "1 tablet daily" }, { text: "with food" }],
          },
        },
        {
          resource: {
            resourceType: "MedicationRequest",
            id: "m-dangling",
            medicationReference: { reference: "urn:uuid:missing" },
          },
        },
      ]),
    ).toEqual([
      {
        fhirId: "m-two-codings",
        codeSystem: RXNORM,
        code: "197361",
        display: "amLODIPine 5 MG Oral Tablet",
        authoredAt: null,
        status: "stopped",
        intent: null,
        dosageText: ["1 tablet daily", "with food"],
        reasonRefs: [],
      },
      {
        fhirId: "m-dangling",
        codeSystem: "",
        code: "",
        display: "",
        authoredAt: null,
        status: null,
        intent: null,
        dosageText: [],
        reasonRefs: [],
      },
    ]);
  });
});
