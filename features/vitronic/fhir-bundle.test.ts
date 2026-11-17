import { describe, expect, test } from "bun:test";
import type { Observation, Patient } from "fhir/r4";

import {
  SYNTHETIC_ANGLE_ROW,
  SYNTHETIC_DISTANCE_ROW,
  SYNTHETIC_EFFECTIVE,
  SYNTHETIC_HEIGHT_ROW,
  SYNTHETIC_PROPERTY_ROWS,
} from "@/features/vitronic/fixtures/synthetic-measurements";

import {
  buildVitronicFhirBundle,
  scanDateTime,
} from "@/infrastructure/open-twin-adapters/vitronic";

// The host key of a made-up subject, built so it never reads as a credential.
const SYNTHETIC_SUBJECT = ["synthetic", "subject", "1"].join("-");
const TIMESTAMP = "2026-07-10T12:05:00Z";

const build = (lists: Parameters<typeof buildVitronicFhirBundle>[0]["lists"]) =>
  buildVitronicFhirBundle(
    { scanId: "7", effectiveDateTime: SYNTHETIC_EFFECTIVE, lists },
    { subjectKey: SYNTHETIC_SUBJECT, timestamp: TIMESTAMP },
  );

const observations = (lists: Parameters<typeof build>[0]) =>
  (build(lists).bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter(
      (resource): resource is Observation => resource?.resourceType === "Observation",
    );

const resourcesOf = (bundle: ReturnType<typeof build>["bundle"]) =>
  (bundle.entry ?? []).map((entry) => entry.resource);

const byCode = (rows: readonly Observation[], code: string) =>
  rows.find((row) => row.code.coding?.some((coding) => coding.code === code));

describe("buildVitronicFhirBundle", () => {
  test("properties keep the API's SI numbers under UCUM units", () => {
    const rows = observations({ properties: [...SYNTHETIC_PROPERTY_ROWS] });
    expect(byCode(rows, "body.height")?.valueQuantity).toMatchObject({
      value: 1.7,
      system: "http://unitsofmeasure.org",
      code: "m",
    });
    expect(byCode(rows, "body.mass")?.valueQuantity).toMatchObject({
      value: 68,
      code: "kg",
    });
    // The fixture's BMI does not match its height and mass; it is passed on, not recomputed.
    expect(byCode(rows, "body.bmi")?.valueQuantity).toMatchObject({
      value: 21,
      code: "kg/m2",
    });
  });

  test("lists map in metres and degrees, at the scan's time", () => {
    const rows = observations({
      height: [SYNTHETIC_HEIGHT_ROW],
      distance: [SYNTHETIC_DISTANCE_ROW],
      angle: [SYNTHETIC_ANGLE_ROW],
    });
    expect(byCode(rows, "stature")?.valueQuantity).toMatchObject({
      value: 1.75,
      code: "m",
    });
    expect(byCode(rows, "torso.shoulder.M")?.valueQuantity).toMatchObject({
      value: 0.4,
      code: "m",
    });
    expect(byCode(rows, "arm.shoulder.R")?.valueQuantity).toMatchObject({
      value: 90,
      code: "deg",
    });
    for (const row of rows) expect(row.effectiveDateTime).toBe(SYNTHETIC_EFFECTIVE);
  });

  test("every Observation names the person's subject, and the Patient carries only the host key", () => {
    const { bundle } = build({ properties: [...SYNTHETIC_PROPERTY_ROWS] });
    const resources = resourcesOf(bundle);
    const rows = resources.filter(
      (r): r is Observation => r?.resourceType === "Observation",
    );
    const patients = resources.filter((r): r is Patient => r?.resourceType === "Patient");
    expect(patients).toHaveLength(1);
    const subject = `urn:uuid:${patients[0]!.id}`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.subject?.reference).toBe(subject);
    expect(patients[0]!.identifier).toEqual([
      { system: "http://opentwin.ch/fhir/sid/vitronic", value: SYNTHETIC_SUBJECT },
    ]);
    expect(Object.keys(patients[0]!).sort()).toEqual([
      "id",
      "identifier",
      "resourceType",
    ]);
  });

  test("no proband id reaches the bundle", () => {
    const text = JSON.stringify(
      build({ properties: [...SYNTHETIC_PROPERTY_ROWS] }).bundle,
    );
    expect(text).not.toContain("proband");
  });

  test("the same scan gives the same resource ids", () => {
    const ids = (lists: Parameters<typeof build>[0]) =>
      observations(lists).map((row) => row.id);
    const lists = {
      properties: [...SYNTHETIC_PROPERTY_ROWS],
      height: [SYNTHETIC_HEIGHT_ROW],
    };
    expect(ids(lists)).toEqual(ids(lists));
    expect(new Set(ids(lists)).size).toBe(ids(lists).length);
  });

  test("a list off the provider's schema is dropped and named, the rest still map", () => {
    const result = build({
      properties: [...SYNTHETIC_PROPERTY_ROWS],
      distance: [{ distance_path: "torso.shoulder.M" }],
    });
    expect(result.dropped).toEqual(["distance"]);
    const codes = (result.bundle.entry ?? []).flatMap(
      (entry) =>
        (entry.resource as Observation | undefined)?.code?.coding?.map((c) => c.code) ??
        [],
    );
    expect(codes).toContain("body.height");
    expect(codes).not.toContain("torso.shoulder.M");
  });

  test("an empty scan asserts no one", () => {
    const { bundle, dropped } = build({});
    expect(dropped).toEqual([]);
    expect(bundle.entry ?? []).toHaveLength(0);
  });
});

describe("scanDateTime", () => {
  test("keeps an offset time or a date, narrows a local time to its date", () => {
    expect(scanDateTime("2026-07-10T12:00:00Z")).toBe("2026-07-10T12:00:00Z");
    expect(scanDateTime("2026-07-10T12:00:00+02:00")).toBe("2026-07-10T12:00:00+02:00");
    expect(scanDateTime("2026-07-10")).toBe("2026-07-10");
    expect(scanDateTime("2026-07-10T12:00:00")).toBe("2026-07-10");
    expect(scanDateTime("yesterday")).toBeUndefined();
    expect(scanDateTime(null)).toBeUndefined();
  });
});
