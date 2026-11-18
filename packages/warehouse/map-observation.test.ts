import { describe, expect, test } from "bun:test";

import { SYSTEMS } from "@open-twin/fhir-core";

import CGM_BUNDLE from "./fixtures/google-health-glucose.json";
import { mapObservation, mapObservations } from "./map-observation";

const observations = () =>
  CGM_BUNDLE.entry
    .map((entry) => entry.resource)
    .filter((resource) => resource.resourceType === "Observation");

const numericRows = (resources: readonly unknown[]) =>
  resources
    .flatMap(mapObservations)
    .flatMap((mapped) =>
      mapped.kind === "numeric"
        ? [[mapped.row.loinc, mapped.row.display, mapped.row.value, mapped.row.unitUcum]]
        : [],
    );

const glucose = (component?: readonly unknown[]) => ({
  resourceType: "Observation",
  id: "glucose-1",
  code: { coding: [{ system: "http://loinc.org", code: "2339-0", display: "Glucose" }] },
  valueQuantity: { value: 140, system: "http://unitsofmeasure.org", code: "mg/dL" },
  effectiveDateTime: "2026-11-16T07:00:00Z",
  ...(component ? { component } : {}),
});

const specimen = (value: string, system: string = SYSTEMS.GOOGLE_HEALTH) => ({
  code: { coding: [{ system, code: "specimen", display: "Specimen source" }] },
  valueString: value,
});

describe("glucose by specimen", () => {
  test("Google Health readings from interstitial fluid are stored as sensor glucose", () => {
    expect(numericRows(observations())).toEqual([
      ["99504-3", "Glucose [Mass/volume] in Interstitial fluid", 95, "mg/dL"],
      ["99504-3", "Glucose [Mass/volume] in Interstitial fluid", 101, "mg/dL"],
      ["2339-0", "Glucose [Mass/volume] in Blood", 104, "mg/dL"],
      ["99504-3", "Glucose [Mass/volume] in Interstitial fluid", 118, "mg/dL"],
    ]);
  });

  test("glucose without a specimen stays blood glucose", () => {
    expect(numericRows([glucose()])).toEqual([["2339-0", "Glucose", 140, "mg/dL"]]);
  });

  test("a specimen under another code system is not read", () => {
    expect(
      numericRows([glucose([specimen("INTERSTITIAL_FLUID", "urn:example:specimen")])]),
    ).toEqual([["2339-0", "Glucose", 140, "mg/dL"]]);
  });

  test("only glucose in blood moves: another code with the specimen keeps its code", () => {
    const other = {
      ...glucose([specimen("INTERSTITIAL_FLUID")]),
      code: {
        coding: [
          { system: "http://loinc.org", code: "2345-7", display: "Glucose SerPl" },
        ],
      },
    };
    expect(mapObservation(other)).toMatchObject({
      kind: "numeric",
      row: { loinc: "2345-7" },
    });
  });
});
