import { describe, expect, test } from "bun:test";

import { systemForGroup } from "@/packages/anatomy/hra-groups";

import { anchorLayer } from "./anchor-layer";
import { ORGAN_MAP, organStatus, type MarkerValue } from "./organ-map";

const value = (loinc: string, amount: number, unitUcum: string): MarkerValue => ({
  loinc,
  value: amount,
  unitUcum,
});

describe("organ map", () => {
  test("every code is in the Anchor catalogue, once", () => {
    const codes = new Set(anchorLayer.biomarkers.map((marker) => marker.loincCode));
    expect(ORGAN_MAP.filter((row) => !codes.has(row.loinc))).toEqual([]);
    expect(new Set(ORGAN_MAP.map((row) => row.loinc)).size).toBe(ORGAN_MAP.length);
  });

  test("every organ is an HRA organ group the anatomy layer classifies", () => {
    expect(ORGAN_MAP.filter((row) => systemForGroup(row.organ) === null)).toEqual([]);
    expect([...new Set(ORGAN_MAP.map((row) => row.organ))]).toEqual([
      "liver",
      "kidney",
      "pancreas",
      "bloodvasculature",
    ]);
    expect(ORGAN_MAP).toHaveLength(11);
  });
});

describe("organStatus", () => {
  test("without sex or age only general intervals give a position", () => {
    const status = organStatus([
      value("2571-8", 180, "mg/dL"),
      value("4548-4", 5.2, "%"),
      value("2093-3", 250, "mg/dL"),
      value("2324-2", 5, "U/L"),
    ]);
    expect(status).toEqual([
      {
        organ: "pancreas",
        position: "within",
        markerId: "BM-139",
        loinc: "4548-4",
        label: "HbA1c",
      },
      {
        organ: "bloodvasculature",
        position: "above",
        markerId: "BM-383",
        loinc: "2571-8",
        label: "Triglyceride",
      },
    ]);
  });

  test("outside beats within, and the first marker in the table keeps a tie", () => {
    const context = { sex: "male", ageYears: 40, qualifiers: ["fasting"] } as const;
    const status = organStatus(
      [
        value("2324-2", 5, "U/L"),
        value("1742-6", 60, "U/L"),
        value("4548-4", 5.2, "%"),
        value("1558-6", 110, "mg/dL"),
        value("2085-9", 50, "mg/dL"),
        value("2571-8", 180, "mg/dL"),
      ],
      context,
    );
    expect(status).toEqual([
      {
        organ: "liver",
        position: "above",
        markerId: "BM-132",
        loinc: "1742-6",
        label: "GPT (ALAT)",
      },
      {
        organ: "pancreas",
        position: "above",
        markerId: "BM-128",
        loinc: "1558-6",
        label: "Glukose",
      },
      {
        organ: "bloodvasculature",
        position: "above",
        markerId: "BM-383",
        loinc: "2571-8",
        label: "Triglyceride",
      },
    ]);
  });

  test("another unit, an unmapped code or no values set nothing", () => {
    expect(organStatus([value("2571-8", 2, "mmol/L")])).toEqual([]);
    expect(organStatus([value("718-7", 13.4, "g/dL")])).toEqual([]);
    expect(organStatus([])).toEqual([]);
  });
});
