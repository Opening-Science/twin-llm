import { describe, expect, test } from "bun:test";

import cohortCodes from "@/evaluation/cohort-codes.v1.json";
import { anchorLayer, type AnchorLayer } from "@/packages/biomarkers/anchor-layer";

import { catalogueMeasureName, catalogueMeasureNames } from "./measure-names";

describe("catalogueMeasureName", () => {
  test("names wearable codes and Anchor markers in words", () => {
    expect(catalogueMeasureName("8867-4")).toBe("Heart rate");
    expect(catalogueMeasureName("2093-3")).toBe("Cholesterol");
    expect(catalogueMeasureName("2085-9")).toBe("Cholesterol in HDL");
    expect(catalogueMeasureName("4548-4")).toBe("HbA1c");
  });

  test("an unknown code has no name, and nothing is made from the code", () => {
    expect(catalogueMeasureName("99999-9")).toBeNull();
    expect(catalogueMeasureName("")).toBeNull();
  });

  test("a wearable name wins where Anchor names the same code", () => {
    const marker = anchorLayer.biomarkers[0]!;
    const layer: AnchorLayer = {
      ...anchorLayer,
      biomarkers: [{ ...marker, loincCode: "8867-4", loincDisplay: "Pulse [x] in y" }],
    };
    expect(catalogueMeasureNames(layer).get("8867-4")).toBe("Heart rate");
  });

  test("every code the synthetic cohort holds has a name (#542)", () => {
    const unnamed = cohortCodes.codes.filter(
      (code) => catalogueMeasureName(code) === null,
    );
    expect(unnamed).toEqual([]);
    expect(cohortCodes.codes.length).toBeGreaterThan(100);
  });

  test("names the cohort's blood pressure and glucose in words (#542)", () => {
    expect(catalogueMeasureName("8480-6")).toBe("Systolic blood pressure");
    expect(catalogueMeasureName("8462-4")).toBe("Diastolic blood pressure");
    expect(catalogueMeasureName("2339-0")).toBe("Blood glucose");
  });
});
