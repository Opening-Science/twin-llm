import { describe, expect, test } from "bun:test";

import { createMeasurementCatalogue } from "@open-twin/aggregate";
import { GOOGLE_HEALTH_MEASUREMENTS } from "@open-twin/provider-google-health";
import { OURA_MEASUREMENTS } from "@open-twin/provider-oura";
import { WHOOP_MEASUREMENTS } from "@open-twin/provider-whoop";

import { anchorLayer } from "./anchor-layer";
import { MEASUREMENT_VITALS, twinTargetRows } from "./twin-targets";

const ROWS = twinTargetRows();

const row = (key: string) => ROWS.find((one) => one.key === key);

describe("twinTargetRows", () => {
  test("one row per Anchor marker by LOINC, then one per measurement key", () => {
    const markers = anchorLayer.biomarkers.length;
    expect(ROWS.length).toBe(markers + 12);
    expect(ROWS.slice(0, markers).every((one) => one.keyKind === "loinc")).toBe(true);
    expect(ROWS.slice(markers).map((one) => one.key)).toEqual(
      Object.keys(MEASUREMENT_VITALS),
    );
    expect(new Set(ROWS.map((one) => one.key)).size).toBe(ROWS.length);
  });

  test("a liver marker names each donor's own liver keys", () => {
    expect(row("1742-6")).toEqual({
      key: "1742-6",
      keyKind: "loinc",
      source: "BM-132",
      target3d: {
        male: ["#VHMLiver", "#VHMDuctsLiver"],
        female: ["#VHFLiver", "#VHFLiverDucts"],
      },
    });
  });

  test("a marker one atlas cannot show is empty on that side only", () => {
    expect(row("2857-1")?.target3d).toEqual({ male: ["#VHMProstate"], female: [] });
    expect(row("14715-7")?.target3d).toEqual({
      male: [],
      female: ["#VHFLeftOvary", "#VHFRightOvary"],
    });
  });

  test("a marker with no single place, or a gland no atlas models, is empty on both", () => {
    // Kreatinin is D12 unrenderable although Anchor lists the kidney.
    const kreatinin = anchorLayer.biomarkers.find((marker) => marker.id === "BM-436");
    expect(kreatinin && row(kreatinin.loincCode)?.target3d).toEqual({
      male: [],
      female: [],
    });
    const lit = ROWS.filter(
      (one) => one.target3d.male.length > 0 || one.target3d.female.length > 0,
    );
    expect(lit.filter((one) => one.keyKind === "loinc").length).toBe(26);
  });

  test("measurement keys light what their vital lights", () => {
    expect(
      ["heart-rate", "google-health:daily-respiratory-rate", "step-count"].map((key) => [
        key,
        row(key)?.source,
        row(key)?.target3d,
      ]),
    ).toEqual([
      ["heart-rate", "heartRate", { male: ["#VHMHeart"], female: ["#VHFHeartV1.1"] }],
      [
        "google-health:daily-respiratory-rate",
        "respiration",
        {
          male: ["#VHMLungV1.1", "#VHMTrachea"],
          female: ["#VHFLungV1.2", "#VHFTrachea"],
        },
      ],
      ["step-count", "steps", { male: [], female: [] }],
    ]);
  });

  test("every measurement key is in open-twin's catalogue at the current pin", () => {
    const catalogue = createMeasurementCatalogue([
      OURA_MEASUREMENTS,
      WHOOP_MEASUREMENTS,
      GOOGLE_HEALTH_MEASUREMENTS,
    ]);
    const known = new Set(catalogue.entries.map((entry) => entry.key));
    expect(Object.keys(MEASUREMENT_VITALS).filter((key) => !known.has(key))).toEqual([]);
  });
});
