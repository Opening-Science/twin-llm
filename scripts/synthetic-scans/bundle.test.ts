import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normaliseBundle } from "@open-twin/fhir-r4";

import { mapObservations, type NumericRow } from "@/packages/warehouse/map-observation";
import { isSyntheaBundle } from "@/packages/warehouse/synthea-marker";

import { syntheaPatientOf } from "../synthetic-wearables/bundle";
import { SCAN_GENERATOR_ID, syntheticScanBundle, syntheticScanId } from "./bundle";
import { syntheticScanOf } from "./scan";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/synthea");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/** patient-2 has height 175.3 cm, weight 85.2 kg and BMI 27.72 at one visit. */
const MEASURED = fixture("patient-2.json");
const UNMEASURED = fixture("patient-1.json");

const scanBundle = () => {
  const patient = syntheaPatientOf(MEASURED)!;
  return { patient, bundle: syntheticScanBundle(patient, syntheticScanOf(MEASURED)!) };
};

describe("syntheticScanOf", () => {
  test("takes height in metres, weight and BMI as recorded, at the visit's time", () => {
    expect(syntheticScanOf(MEASURED)).toEqual({
      effectiveDateTime: "2017-02-11T04:29:26+01:00",
      properties: [
        { property_path: "body.height", value: 1.753 },
        { property_path: "body.mass", value: 85.2 },
        { property_path: "body.bmi", value: 27.72 },
      ],
    });
  });

  test("a record without height and weight at one visit gives no scan", () => {
    expect(syntheticScanOf(UNMEASURED)).toBeNull();
  });

  test("the latest visit with both wins, and BMI is left out rather than computed", () => {
    const observation = (code: string, at: string, value: number, unit: string) => ({
      resource: {
        resourceType: "Observation",
        code: { coding: [{ system: "http://loinc.org", code }] },
        effectiveDateTime: at,
        valueQuantity: { value, code: unit },
      },
    });
    const bundle = {
      entry: [
        observation("8302-2", "2020-01-01T10:00:00Z", 170, "cm"),
        observation("29463-7", "2020-01-01T10:00:00Z", 70, "kg"),
        observation("39156-5", "2020-01-01T10:00:00Z", 24.2, "kg/m2"),
        observation("8302-2", "2022-01-01T10:00:00Z", 171, "cm"),
        observation("29463-7", "2022-01-01T10:00:00Z", 72, "kg"),
        // A height with no weight at the same time is not a scan.
        observation("8302-2", "2023-01-01T10:00:00Z", 172, "cm"),
      ],
    };
    expect(syntheticScanOf(bundle)).toEqual({
      effectiveDateTime: "2022-01-01T10:00:00Z",
      properties: [
        { property_path: "body.height", value: 1.71 },
        { property_path: "body.mass", value: 72 },
      ],
    });
  });
});

describe("syntheticScanBundle", () => {
  test("is a Synthea bundle for the same subject, so the warehouse accepts it", () => {
    const { patient, bundle } = scanBundle();
    expect(isSyntheaBundle(bundle)).toBe(true);
    const first = bundle.entry[0]!.resource as { resourceType: string; id: string };
    expect(first).toMatchObject({ resourceType: "Patient", id: patient.id });
  });

  test("normalises and maps to numeric warehouse rows in the provider's codes and UCUM units", () => {
    const { patient, bundle } = scanBundle();
    const normalised = normaliseBundle(bundle, {
      connector: { connector: "synthea", version: "v4.0.0" },
      subjectKey: patient.id,
      bundleKey: "test",
      timestamp: "2026-11-18T00:00:00Z",
      type: "collection",
      unresolvedUrnPolicy: "preserve",
    });
    expect(normalised.bundle).toBeDefined();
    const mapped = (normalised.bundle?.entry ?? []).flatMap((entry) =>
      mapObservations(entry.resource),
    );
    expect(mapped.some((item) => item.kind !== "numeric")).toBe(false);
    const rows = mapped.map((item) => (item as { row: NumericRow }).row);
    expect(
      rows
        .map((row) => [row.loinc, row.value, row.unitUcum, row.effectiveAt.toISOString()])
        .sort(),
    ).toEqual([
      ["body.bmi", 27.72, "kg/m2", "2017-02-11T03:29:26.000Z"],
      ["body.height", 1.753, "m", "2017-02-11T03:29:26.000Z"],
      ["body.mass", 85.2, "kg", "2017-02-11T03:29:26.000Z"],
    ]);
  });

  test("every Observation names the Synthea subject and is tagged as generated test data", () => {
    const { patient, bundle } = scanBundle();
    for (const entry of bundle.entry.slice(1)) {
      const resource = entry.resource as {
        subject?: { reference?: string };
        meta?: { tag?: Array<{ code?: string }> };
      };
      expect(resource.subject?.reference).toBe(`urn:uuid:${patient.id}`);
      const codes = (resource.meta?.tag ?? []).map((tag) => tag.code);
      expect(codes).toContain("HTEST");
      expect(codes).toContain(SCAN_GENERATOR_ID);
    }
  });

  test("the same subject and visit give the same bundle", () => {
    expect(JSON.stringify(scanBundle().bundle)).toBe(JSON.stringify(scanBundle().bundle));
    const { patient } = scanBundle();
    expect(syntheticScanId(patient.id, syntheticScanOf(MEASURED)!)).toMatch(
      /^synthetic-[0-9a-f-]{36}$/,
    );
  });
});
