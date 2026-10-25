import { describe, expect, test } from "bun:test";

import { LOINC_CODINGS } from "@open-twin/fhir-core";
import type { Observation } from "fhir/r4";

import { buildWhoopFhirBundle } from "@/infrastructure/open-twin-adapters/whoop";

import { SYNTHETIC_WHOOP_PAYLOAD } from "./fixtures/synthetic-sync-payload";

const WHOOP = "http://opentwin.ch/fhir/CodeSystem/whoop";
const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const SYNTHETIC_SUBJECT = "synthetic-wearer-1";

const bundle = buildWhoopFhirBundle(SYNTHETIC_WHOOP_PAYLOAD, {
  subjectKey: SYNTHETIC_SUBJECT,
  timestamp: "2026-01-05T00:00:00Z",
});

const observations = (bundle.entry ?? [])
  .map((e) => e.resource)
  .filter((r): r is Observation => r?.resourceType === "Observation");

const row = (o: Observation) => ({
  code: (o.code.coding ?? []).map((c) => `${c.system}|${c.code}`),
  effective: o.effectiveDateTime,
  value: o.valueQuantity ?? null,
});

describe("provider-whoop FHIR bundle golden", () => {
  test("Patient first, then observations in mapper order", () => {
    expect((bundle.entry ?? []).map((e) => e.resource?.resourceType)).toEqual([
      "Patient",
      ...Array.from({ length: 10 }, () => "Observation"),
    ]);
  });

  test("observation codes, effective times and UCUM quantities", () => {
    expect(observations.map(row)).toEqual([
      {
        code: [`${WHOOP}|recovery-score`],
        effective: "2026-01-02T07:00:00.000Z",
        value: { value: 64, unit: "score", system: UCUM, code: "{score}" },
      },
      {
        code: [`${WHOOP}|hrv-rmssd`],
        effective: "2026-01-02T07:00:00.000Z",
        value: { value: 48.27, unit: "millisecond", system: UCUM, code: "ms" },
      },
      {
        code: [`${LOINC}|8867-4`],
        effective: "2026-01-02T07:00:00.000Z",
        value: { value: 52, unit: "per minute", system: UCUM, code: "/min" },
      },
      {
        code: [`${WHOOP}|spo2`],
        effective: "2026-01-02T07:00:00.000Z",
        value: null,
      },
      {
        code: [`${WHOOP}|recovery-score`],
        effective: "2026-01-03T07:00:00.000Z",
        value: { value: 40, unit: "score", system: UCUM, code: "{score}" },
      },
      {
        code: [`${WHOOP}|day-strain`],
        effective: "2026-01-01T06:30:00.000Z",
        value: { value: 11.46, unit: "score", system: UCUM, code: "{score}" },
      },
      {
        code: [`${LOINC}|8867-4`],
        effective: "2026-01-01T06:30:00.000Z",
        value: { value: 71, unit: "per minute", system: UCUM, code: "/min" },
      },
      {
        code: [`${WHOOP}|sleep-performance`],
        effective: "2026-01-01T23:10:00.000Z",
        value: { value: 88, unit: "%", system: UCUM, code: "%" },
      },
      {
        code: [`${WHOOP}|sleep-efficiency`],
        effective: "2026-01-01T23:10:00.000Z",
        value: { value: 91.26, unit: "%", system: UCUM, code: "%" },
      },
      {
        code: [`${LOINC}|103213-5`],
        effective: "2026-01-01T23:10:00.000Z",
        value: { value: 450, unit: "minute", system: UCUM, code: "min" },
      },
    ]);
  });

  test("SpO2 carries LOINC 59408-5 on the component, not the root", () => {
    const spo2 = observations[3];
    expect(spo2?.dataAbsentReason?.coding?.[0]?.code).toBe("not-applicable");
    expect(
      spo2?.component?.map((c) => ({
        code: (c.code.coding ?? []).map((x) => `${x.system}|${x.code}`),
        value: c.valueQuantity,
      })),
    ).toEqual([
      {
        code: [`${LOINC}|59408-5`, `${WHOOP}|spo2-percentage`],
        value: { value: 96.44, unit: "%", system: UCUM, code: "%" },
      },
    ]);
  });

  test("every emitted LOINC coding is a fhir-core LOINC_CODINGS entry", () => {
    const loinc = observations
      .flatMap((o) => [
        ...(o.code.coding ?? []),
        ...(o.component ?? []).flatMap((c) => c.code.coding ?? []),
      ])
      .filter((c) => c.system === LOINC)
      .map((c) => ({ system: c.system, code: c.code, display: c.display }));

    expect(loinc).toEqual([
      LOINC_CODINGS.HEART_RATE,
      LOINC_CODINGS.OXYGEN_SATURATION,
      LOINC_CODINGS.HEART_RATE,
      LOINC_CODINGS.TIME_IN_BED,
    ]);
  });
});
