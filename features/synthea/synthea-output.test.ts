import { describe, expect, test } from "bun:test";

import {
  isPatientFile,
  progressFromChunk,
  progressFromLine,
  summarisePatientBundle,
} from "./synthea-output";

describe("progress lines", () => {
  test("reads the person number Synthea prints", () => {
    expect(progressFromLine("1 -- Ann12 Lee34 (43 y/o F) Garland, Texas  (47608)")).toBe(
      1,
    );
    expect(progressFromLine("Loading module modules/asthma.json")).toBe(null);
    expect(progressFromLine("Records: total=2, alive=2, dead=0")).toBe(null);
  });

  test("takes the highest number in a chunk", () => {
    expect(
      progressFromChunk("1 -- A (1 y/o F) X\nWARNING: x\n3 -- B (2 y/o M) Y\n"),
    ).toBe(3);
    expect(progressFromChunk("Running with options:\n")).toBe(null);
  });
});

const bundle = {
  resourceType: "Bundle",
  entry: [
    { resource: { resourceType: "Patient", gender: "female", birthDate: "1980-04-02" } },
    {
      resource: {
        resourceType: "Condition",
        code: { text: "Hypertension" },
        onsetDateTime: "2010-05-01T10:00:00+00:00",
      },
    },
    {
      resource: {
        resourceType: "Condition",
        code: { coding: [{ display: "Asthma", code: "195967001" }] },
        onsetDateTime: "1990-01-01T00:00:00+00:00",
      },
    },
    {
      resource: {
        resourceType: "Observation",
        code: { text: "Body weight" },
        valueQuantity: { value: 70.25, unit: "kg" },
        effectiveDateTime: "2025-01-01T00:00:00+00:00",
      },
    },
    {
      resource: {
        resourceType: "Observation",
        code: { text: "Smoking status" },
        valueCodeableConcept: { text: "Never" },
        effectiveDateTime: "2025-02-01T00:00:00+00:00",
      },
    },
    {
      resource: {
        resourceType: "Observation",
        code: { text: "Heart rate" },
        valueQuantity: { value: 72, unit: "/min" },
        effectiveDateTime: "2025-03-01T00:00:00+00:00",
      },
    },
    { resource: { resourceType: "Encounter" } },
    { resource: { resourceType: "MedicationRequest" } },
  ],
};

describe("summarisePatientBundle", () => {
  test("counts resources and lists conditions and numeric measurements", () => {
    expect(summarisePatientBundle(bundle)).toEqual({
      sex: "female",
      birthDate: "1980-04-02",
      deceasedDate: null,
      counts: {
        conditions: 2,
        observations: 3,
        encounters: 1,
        medicationRequests: 1,
        procedures: 0,
        immunizations: 0,
      },
      conditions: [
        { label: "Asthma", detail: "1990-01-01" },
        { label: "Hypertension", detail: "2010-05-01" },
      ],
      observations: [
        { label: "Heart rate", value: 72, unit: "/min", date: "2025-03-01" },
        { label: "Body weight", value: 70.25, unit: "kg", date: "2025-01-01" },
      ],
    });
  });

  test("is null without a Patient or for something that is not a bundle", () => {
    expect(
      summarisePatientBundle({ entry: [{ resource: { resourceType: "Encounter" } }] }),
    ).toBe(null);
    expect(summarisePatientBundle("nope")).toBe(null);
    expect(summarisePatientBundle(null)).toBe(null);
  });
});

describe("isPatientFile", () => {
  test("skips hospital and practitioner files", () => {
    expect(isPatientFile("bfc9945a-0277.json")).toBe(true);
    expect(isPatientFile("hospitalInformation1767225600000.json")).toBe(false);
    expect(isPatientFile("practitionerInformation1767225600000.json")).toBe(false);
    expect(isPatientFile("patients.csv")).toBe(false);
  });
});
