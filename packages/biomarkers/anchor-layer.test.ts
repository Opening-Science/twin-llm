import { describe, expect, test } from "bun:test";

import raw from "@open-twin/anchor-layer/data/anchor-layer.v1.json";

import { anchorLayer, parseAnchorLayer } from "./anchor-layer";

const countBy = <T>(
  items: readonly T[],
  key: (item: T) => string,
): Record<string, number> =>
  items.reduce<Record<string, number>>(
    (counts, item) => ({ ...counts, [key(item)]: (counts[key(item)] ?? 0) + 1 }),
    {},
  );

describe("pinned Anchor layer", () => {
  test("67 biomarkers with the published tier counts", () => {
    expect(anchorLayer.biomarkers).toHaveLength(67);
    expect(countBy(anchorLayer.biomarkers, (marker) => marker.tier)).toEqual({
      core_tier1: 35,
      core_tier2: 18,
      core_tier1_decomposed: 14,
    });
  });

  test("system counts come from Anchor as they are", () => {
    expect(countBy(anchorLayer.biomarkers, (marker) => marker.systemId)).toEqual({
      metabolic: 37,
      endocrine: 9,
      digestive: 6,
      reproductive: 5,
      musculoskeletal: 5,
      cardiovascular: 5,
    });
  });

  test("44 reference intervals over 30 markers, and no interpretive band among them", () => {
    expect(anchorLayer.referenceIntervals).toHaveLength(44);
    expect(new Set(anchorLayer.referenceIntervals.map((i) => i.biomarkerId)).size).toBe(
      30,
    );
    // LDL (BM-190) has bands only (D-c): it must not gain an interval here.
    expect(anchorLayer.referenceIntervals.some((i) => i.biomarkerId === "BM-190")).toBe(
      false,
    );
  });

  test("the three D11 markers are blocked, and so are their intervals", () => {
    expect(anchorLayer.biomarkers.filter((m) => m.blocked).map((m) => m.id)).toEqual([
      "BM-060",
      "BM-186",
      "BM-405",
    ]);
    expect(
      anchorLayer.referenceIntervals.filter((i) => i.blocked).map((i) => i.id),
    ).toEqual(["RI-017"]);
  });

  test("source workbook and its sha256 are carried through", () => {
    expect(anchorLayer.sourceFile).toBe(
      "docs/evidence/source/2026_07_28_OpenTwin_AnchorLayer_v3_Consolidated.xlsx",
    );
    expect(anchorLayer.sourceSha256).toBe(
      "42c027317bad0511ae3faed46f3ae49c2fb86f175fe8c58982d403c32d8f987e",
    );
  });

  test("a marker reads as Anchor wrote it", () => {
    expect(anchorLayer.biomarkers.find((m) => m.id === "BM-107")).toEqual({
      id: "BM-107",
      nameDe: "Ferritin",
      loincCode: "2276-4",
      loincDisplay: "Ferritin [Mass/volume] in Serum or Plasma",
      tier: "core_tier1",
      unitUcum: "ng/mL",
      unitSource: "ng/ml",
      systemId: "metabolic",
      regionIds: ["bone_marrow_blood", "micronutrient_status"],
      organMappingSource: "Hematologic, Nutritional",
      flag: "none",
      blocked: false,
    });
  });
});

describe("parseAnchorLayer fails fast", () => {
  const base = raw as unknown as Readonly<Record<string, unknown>>;
  const firstMarker = (base.biomarkers as readonly Record<string, unknown>[])[0]!;

  test("wrong schema version", () => {
    expect(() =>
      parseAnchorLayer({ ...base, schema_version: "anchor-layer.v2" }),
    ).toThrow(
      "anchor-layer: expected schema_version anchor-layer.v1, got anchor-layer.v2",
    );
  });

  test("unknown region", () => {
    const biomarkers = [{ ...firstMarker, region_ids: ["spleen"] }];
    expect(() =>
      parseAnchorLayer({ ...base, biomarkers, reference_intervals: [] }),
    ).toThrow('anchor-layer: BM-001 has unknown region "spleen"');
  });

  test("a tenth system", () => {
    const biomarkers = [{ ...firstMarker, system_id: "immune" }];
    expect(() =>
      parseAnchorLayer({ ...base, biomarkers, reference_intervals: [] }),
    ).toThrow('anchor-layer: BM-001 has unknown system "immune"');
  });

  test("an interval for a marker that is not in the catalogue", () => {
    const intervals = base.reference_intervals as readonly Record<string, unknown>[];
    expect(() =>
      parseAnchorLayer({
        ...base,
        biomarkers: [firstMarker],
        reference_intervals: [intervals[2]],
      }),
    ).toThrow("anchor-layer: RI-017 points at unknown BM-060");
  });
});
