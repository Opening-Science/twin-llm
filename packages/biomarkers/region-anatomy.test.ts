import { describe, expect, test } from "bun:test";

import { systemForGroup } from "@/packages/anatomy/hra-groups";

import { ANCHOR_REGION_IDS, anchorLayer } from "./anchor-layer";
import { biomarkerById } from "./catalogue";
import {
  GLAND_NOT_MODELLED,
  markerAnatomy,
  MUSCLE_NOT_MODELLED,
  NO_SINGLE_LOCATION,
  REGION_ANATOMY,
} from "./region-anatomy";
import { UNRENDERABLE_IDS } from "./unrenderable";

const marker = (id: string) => biomarkerById(id)!;

describe("region table", () => {
  test("covers exactly the 20 regions the pinned layer uses", () => {
    const used = new Set(anchorLayer.biomarkers.flatMap((m) => m.regionIds));
    expect(used.size).toBe(20);
    expect([...used].sort()).toEqual([...ANCHOR_REGION_IDS]);
    expect(Object.keys(REGION_ANATOMY).sort()).toEqual([...ANCHOR_REGION_IDS]);
  });

  test("every HRA key is one hra-groups.ts classifies", () => {
    const unknown = Object.values(REGION_ANATOMY)
      .flatMap((row) => row.target?.hraGroups ?? [])
      .filter((key) => systemForGroup(key) === null);
    expect(unknown).toEqual([]);
  });

  test("BodyParts3D shows the atlas's own system for those organs", () => {
    for (const row of Object.values(REGION_ANATOMY)) {
      for (const key of row.target?.hraGroups ?? []) {
        expect(systemForGroup(key)).toBe(row.target!.bodyParts3dSystem!);
      }
    }
  });

  test("which regions light nothing, and which only a whole system", () => {
    const shape = Object.fromEntries(
      ANCHOR_REGION_IDS.map((id) => {
        const target = REGION_ANATOMY[id].target;
        if (!target) return [id, "none"];
        return [
          id,
          target.hraGroups.length === 0 ? `system:${target.bodyParts3dSystem}` : "organs",
        ];
      }),
    );
    expect(shape).toEqual({
      adrenal: "system:endocrine",
      biliary: "organs",
      bone: "organs",
      bone_marrow_blood: "none",
      electrolyte_balance: "none",
      gonads: "organs",
      gut: "organs",
      immune: "none",
      kidney: "organs",
      lipid_transport: "none",
      liver: "organs",
      metabolic_glycemic: "none",
      micronutrient_status: "none",
      parathyroid: "system:endocrine",
      pituitary: "system:endocrine",
      prostate: "organs",
      skeletal_muscle: "system:musculoskeletal",
      systemic_inflammation: "none",
      thyroid: "system:endocrine",
      vasculature: "organs",
    });
  });
});

describe("markerAnatomy", () => {
  test("D12 lists 14 markers, and all are in the catalogue", () => {
    expect(UNRENDERABLE_IDS.size).toBe(14);
    expect([...UNRENDERABLE_IDS].filter((id) => !biomarkerById(id))).toEqual([]);
  });

  test("no unrenderable marker lights anything, even one with a kidney region", () => {
    for (const id of UNRENDERABLE_IDS) {
      expect(markerAnatomy(marker(id))).toEqual({
        targets: [],
        note: NO_SINGLE_LOCATION,
      });
    }
    expect(marker("BM-436").regionIds).toEqual(["kidney"]);
  });

  test("a marker with only systemic regions has no single location", () => {
    expect(markerAnatomy(marker("BM-411"))).toEqual({
      targets: [],
      note: NO_SINGLE_LOCATION,
    });
    expect(markerAnatomy(marker("BM-107"))).toEqual({
      targets: [],
      note: NO_SINGLE_LOCATION,
    });
  });

  test("a gland marker shows the whole endocrine system with the note", () => {
    expect(markerAnatomy(marker("BM-386"))).toEqual({
      targets: [
        { hraGroups: [], bodyParts3dSystem: "endocrine" },
        { hraGroups: [], bodyParts3dSystem: "endocrine" },
      ],
      note: GLAND_NOT_MODELLED,
    });
  });

  test("an organ marker lights its organs, and skips its systemic regions", () => {
    expect(markerAnatomy(marker("BM-072"))).toEqual({
      targets: [REGION_ANATOMY.vasculature.target!, REGION_ANATOMY.liver.target!],
    });
  });

  test("GOT lights the liver and the musculoskeletal system", () => {
    expect(markerAnatomy(marker("BM-130"))).toEqual({
      targets: [REGION_ANATOMY.liver.target!, REGION_ANATOMY.skeletal_muscle.target!],
      note: MUSCLE_NOT_MODELLED,
    });
  });

  test("how many markers light something", () => {
    const lit = anchorLayer.biomarkers.filter((m) => markerAnatomy(m).targets.length > 0);
    expect(lit).toHaveLength(32);
  });
});
