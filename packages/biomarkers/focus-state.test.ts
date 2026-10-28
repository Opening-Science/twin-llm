import { describe, expect, test } from "bun:test";

import { focusLoincs, focusOrgans, focusOrganStatus } from "./focus-state";
import { type MarkerValue } from "./organ-map";

const value = (loinc: string, amount: number, unitUcum: string): MarkerValue => ({
  loinc,
  value: amount,
  unitUcum,
});

describe("focusOrgans", () => {
  test("an organ in the map is itself", () => {
    expect(focusOrgans("liver")).toEqual(["liver"]);
  });

  test("an organ with no mapped marker has none", () => {
    expect(focusOrgans("heart")).toEqual([]);
  });

  test("a system takes every mapped organ the group table files under it", () => {
    expect(focusOrgans("metabolic")).toEqual(["liver", "pancreas"]);
    expect(focusOrgans("cardiovascular")).toEqual(["bloodvasculature"]);
    expect(focusOrgans("endocrine")).toEqual(["kidney"]);
    expect(focusOrgans("nervous")).toEqual([]);
  });
});

describe("focusLoincs", () => {
  test("the codes of the focus's organs, in table order", () => {
    expect(focusLoincs("metabolic")).toEqual([
      "1742-6",
      "1920-8",
      "2324-2",
      "4548-4",
      "1558-6",
    ]);
    expect(focusLoincs("lung")).toEqual([]);
  });
});

describe("focusOrganStatus", () => {
  const values = [
    value("2571-8", 180, "mg/dL"),
    value("4548-4", 5.2, "%"),
    value("2093-3", 250, "mg/dL"),
  ];

  test("keeps only the focus's organs", () => {
    expect(focusOrganStatus("bloodvasculature", values)).toEqual([
      {
        organ: "bloodvasculature",
        position: "above",
        markerId: "BM-383",
        loinc: "2571-8",
        label: "Triglyceride",
      },
    ]);
  });

  test("a system lists each of its organs with a position", () => {
    expect(focusOrganStatus("metabolic", values)).toEqual([
      {
        organ: "pancreas",
        position: "within",
        markerId: "BM-139",
        loinc: "4548-4",
        label: "HbA1c",
      },
    ]);
  });

  test("no values, no state", () => {
    expect(focusOrganStatus("liver", [])).toEqual([]);
  });
});
