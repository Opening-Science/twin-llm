import { describe, expect, test } from "bun:test";

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
});
