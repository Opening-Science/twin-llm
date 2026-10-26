import { describe, expect, test } from "bun:test";

import type { Observation } from "fhir/r4";

import { buildOuraFhirBundle } from "@/infrastructure/open-twin-adapters/oura-bundle";

import { SYNTHETIC_OURA_DATA } from "./fixtures/synthetic-sync-data";

const OURA = "http://opentwin.ch/fhir/CodeSystem/oura";
const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const DATA_ABSENT = "http://terminology.hl7.org/CodeSystem/data-absent-reason";
const SYNTHETIC_SUBJECT = "synthetic-wearer-1";

const bundle = buildOuraFhirBundle(
  SYNTHETIC_OURA_DATA,
  {
    types: ["workout", "daily_spo2", "daily_stress", "vO2_max"],
    start_date: "2026-01-01",
    end_date: "2026-01-04",
  },
  { subjectKey: SYNTHETIC_SUBJECT, timestamp: "2026-01-05T00:00:00Z" },
);

const observations = (bundle.entry ?? [])
  .map((e) => e.resource)
  .filter((r): r is Observation => r?.resourceType === "Observation");

const codes = (concept: { coding?: readonly { system?: string; code?: string }[] }) =>
  (concept.coding ?? []).map((c) => `${c.system}|${c.code}`);

const row = (o: Observation) => ({
  code: codes(o.code),
  effective: o.effectiveDateTime ?? o.effectivePeriod ?? null,
  value: o.valueQuantity ?? o.valueCodeableConcept ?? null,
  absent: o.dataAbsentReason ? codes(o.dataAbsentReason) : null,
  components: (o.component ?? []).map((c) => ({
    code: codes(c.code),
    value: c.valueQuantity ?? null,
  })),
});

describe("provider-oura FHIR bundle for workouts, SpO2, stress and VO2max", () => {
  test("Patient first, then one observation per record in request order", () => {
    expect((bundle.entry ?? []).map((e) => e.resource?.resourceType)).toEqual([
      "Patient",
      ...Array.from({ length: 8 }, () => "Observation"),
    ]);
    expect(observations.map((o) => o.identifier?.[0]?.value)).toEqual([
      "workout-synthetic-1",
      "workout-synthetic-2",
      "spo2-synthetic-1",
      "spo2-synthetic-2",
      "stress-synthetic-1",
      "stress-synthetic-2",
      "vo2max-synthetic-1",
      "vo2max-synthetic-2",
    ]);
  });

  test("a workout carries calories and distance as UCUM components", () => {
    expect(row(observations[0]!)).toEqual({
      code: [`${OURA}|workout`],
      effective: { start: "2026-01-02T07:00:00+00:00", end: "2026-01-02T07:45:00+00:00" },
      value: null,
      absent: [`${DATA_ABSENT}|not-applicable`],
      components: [
        {
          code: [`${LOINC}|41981-2`],
          value: { value: 412, unit: "kilocalorie", system: UCUM, code: "kcal" },
        },
        {
          code: [`${OURA}|workout-distance`],
          value: { value: 7250, unit: "meter", system: UCUM, code: "m" },
        },
      ],
    });
    expect(observations[0]!.code.text).toBe("running");
  });

  test("a SpO2 night carries the nightly average under LOINC 59408-5 in percent", () => {
    expect(row(observations[2]!)).toEqual({
      code: [`${OURA}|spo2-daily-summary`],
      effective: "2026-01-02",
      value: null,
      absent: [`${DATA_ABSENT}|not-applicable`],
      components: [
        {
          code: [`${LOINC}|59408-5`, `${OURA}|spo2-daily-average`],
          value: { value: 96.8, unit: "%", system: UCUM, code: "%" },
        },
        {
          code: [`${OURA}|breathing-disturbance-index`],
          value: { value: 3, unit: "per hour", system: UCUM, code: "/h" },
        },
      ],
    });
  });

  test("a stress day codes the summary and converts seconds to minutes", () => {
    expect(row(observations[4]!)).toEqual({
      code: [`${OURA}|daily-stress`],
      effective: "2026-01-02",
      value: { coding: [{ system: OURA, code: "normal" }], text: "normal" },
      absent: null,
      components: [
        {
          code: [`${OURA}|stress-high`],
          value: { value: 90, unit: "minute", system: UCUM, code: "min" },
        },
        {
          code: [`${OURA}|recovery-high`],
          value: { value: 30, unit: "minute", system: UCUM, code: "min" },
        },
      ],
    });
  });

  test("a VO2max reading is LOINC 94122-9 in mL/kg/min", () => {
    expect(row(observations[6]!)).toEqual({
      code: [`${LOINC}|94122-9`],
      effective: "2026-01-02T00:00:00+00:00",
      value: {
        value: 41.5,
        unit: "milliliter per kilogram per minute",
        system: UCUM,
        code: "mL/kg/min",
      },
      absent: null,
      components: [],
    });
  });

  test("a missing field is absent or data-absent, never zero", () => {
    expect(row(observations[1]!).components).toEqual([]);
    expect(row(observations[3]!).components).toEqual([]);
    expect(row(observations[5]!)).toEqual({
      code: [`${OURA}|daily-stress`],
      effective: "2026-01-03",
      value: null,
      absent: [`${DATA_ABSENT}|unknown`],
      components: [],
    });
    expect(row(observations[7]!)).toEqual({
      code: [`${LOINC}|94122-9`],
      effective: "2026-01-03T00:00:00+00:00",
      value: null,
      absent: [`${DATA_ABSENT}|unknown`],
      components: [],
    });
    expect(JSON.stringify(bundle)).not.toContain('"value":0');
  });
});
