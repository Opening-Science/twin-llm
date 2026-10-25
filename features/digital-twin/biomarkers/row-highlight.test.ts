import { describe, expect, test } from "bun:test";

import { NOT_IN_ATLAS } from "@/packages/biomarkers/marker-highlight";
import {
  GLAND_NOT_MODELLED,
  NO_SINGLE_LOCATION,
} from "@/packages/biomarkers/region-anatomy";

import { SEE_WITH_DEPTH } from "./biomarker-copy";
import { markerRows } from "./biomarker-rows";
import { lightsSomething, rowHighlight, rowNotes } from "./row-highlight";

const row = (id: string) => markerRows(null).find((item) => item.id === id)!;

const HRA_FEMALE = {
  groups: [
    { key: "liver", label: "Liver" },
    { key: "ovary", label: "Ovary" },
  ],
  partSystems: ["metabolic", "reproductive"] as const,
};

describe("rowHighlight", () => {
  test("a marker row resolves through the region table for the atlas", () => {
    expect(rowHighlight(row("bm:BM-315"), "hra")).toEqual({
      highlight: { kind: "groups", ids: ["prostate"] },
    });
  });
});

describe("lightsSomething", () => {
  test("a group or system the loaded atlas has", () => {
    expect(lightsSomething({ kind: "groups", ids: ["prostate"] }, HRA_FEMALE)).toBe(
      false,
    );
    expect(lightsSomething({ kind: "groups", ids: ["#VHFLiver"] }, HRA_FEMALE)).toBe(
      true,
    );
    expect(lightsSomething({ kind: "system", ids: ["endocrine"] }, HRA_FEMALE)).toBe(
      false,
    );
    expect(
      lightsSomething({ kind: "system", ids: ["endocrine", "metabolic"] }, HRA_FEMALE),
    ).toBe(true);
  });
});

describe("rowNotes", () => {
  const ready = { requested: true, ready: HRA_FEMALE };

  test("nothing to add when the atlas lights the row", () => {
    expect(rowNotes(rowHighlight(row("bm:BM-123"), "hra"), ready)).toEqual([]);
  });

  test("before anyone looks inside, the row says where to look", () => {
    expect(
      rowNotes(rowHighlight(row("bm:BM-386"), "bodyparts3d"), {
        requested: false,
        ready: null,
      }),
    ).toEqual([GLAND_NOT_MODELLED, SEE_WITH_DEPTH]);
  });

  test("a mesh the loaded atlas lacks: PSA on the female atlas", () => {
    expect(rowNotes(rowHighlight(row("bm:BM-315"), "hra"), ready)).toEqual([
      NOT_IN_ATLAS,
    ]);
  });

  test("a row that lights nothing keeps only its reason", () => {
    expect(rowNotes(rowHighlight(row("bm:BM-107"), "hra"), ready)).toEqual([
      NO_SINGLE_LOCATION,
    ]);
    expect(
      rowNotes(rowHighlight(row("bm:BM-386"), "hra"), { requested: false, ready: null }),
    ).toEqual([NOT_IN_ATLAS]);
  });
});
