import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { mapObservations } from "../../packages/warehouse/map-observation";
import { isSyntheaBundle } from "../../packages/warehouse/synthea-marker";

import { stableUuid, syntheaPatientOf, wearableBundle } from "./bundle";
import { generateSeries } from "./series";

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../tests/fixtures/synthea/patient-1.json"),
    "utf8",
  ),
) as unknown;

const PATIENT_ID = "ba419d35-0dfe-8af7-347c-eebf02485a56";

describe("syntheaPatientOf", () => {
  test("copies the id and Synthea identifier only", () => {
    const patient = syntheaPatientOf(fixture);
    expect(patient?.id).toBe(PATIENT_ID);
    expect(patient?.deceased).toBe(false);
    expect(patient?.identifier.map((item) => item.system)).toEqual([
      "https://github.com/synthetichealth/synthea",
    ]);
    expect(Object.keys(patient ?? {}).sort()).toEqual([
      "deceased",
      "id",
      "identifier",
      "resourceType",
    ]);
  });

  test("refuses a bundle without a Synthea Patient", () => {
    const other = {
      resourceType: "Bundle",
      entry: [{ resource: { resourceType: "Patient", id: "p", identifier: [] } }],
    };
    expect(syntheaPatientOf(other)).toBeNull();
    expect(syntheaPatientOf({ resourceType: "Bundle", entry: [] })).toBeNull();
  });

  test("marks a deceased Patient", () => {
    const dead = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "p",
            deceasedDateTime: "2020-01-01T00:00:00Z",
            identifier: [
              { system: "https://github.com/synthetichealth/synthea", value: "p" },
            ],
          },
        },
      ],
    };
    expect(syntheaPatientOf(dead)?.deceased).toBe(true);
  });
});

describe("wearableBundle", () => {
  const patient = syntheaPatientOf(fixture);
  if (patient === null) throw new Error("fixture has no Synthea patient");
  const series = generateSeries({
    seed: 4242,
    subjectRef: PATIENT_ID,
    endDay: "2026-10-01",
    days: 3,
  });
  const bundle = wearableBundle(patient, series);

  test("stays a Synthea bundle for the same subject, tagged as test data", () => {
    expect(isSyntheaBundle(bundle)).toBe(true);
    expect(bundle.entry[0]?.resource).toEqual({
      resourceType: "Patient",
      id: PATIENT_ID,
      meta: bundle.meta,
      identifier: patient.identifier,
    });
    expect(bundle.meta.tag[0].code).toBe("HTEST");
    expect(bundle.entry.length).toBe(series.length + 1);
  });

  test("maps to warehouse rows with LOINC and UCUM", () => {
    const rows = bundle.entry.flatMap((entry) => mapObservations(entry.resource));
    const first = rows[0];
    expect(first?.kind).toBe("numeric");
    if (first?.kind !== "numeric") return;
    expect(first.row).toEqual({
      loinc: "8867-4",
      display: "Heart rate",
      value: series[0]?.value ?? Number.NaN,
      unitUcum: "/min",
      effectiveAt: new Date(`${series[0]?.day}T12:00:00Z`),
      fhirId: stableUuid(
        `twinllm-synthetic-wearables:${PATIENT_ID}:heart_rate:${series[0]?.day}`,
      ),
    });
    expect(rows.every((row) => row.kind === "numeric")).toBe(true);
  });

  test("ids are stable and UUID-shaped", () => {
    expect(stableUuid("a")).toBe(stableUuid("a"));
    expect(stableUuid("a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
