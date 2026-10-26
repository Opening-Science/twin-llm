import { describe, expect, test } from "bun:test";

import { LOINC_CODINGS } from "@open-twin/fhir-core";
import type { Observation } from "fhir/r4";

import { buildWhoopFhirBundle } from "@/infrastructure/open-twin-adapters/whoop";
import { fetchWhoopWorkouts } from "@/infrastructure/open-twin-adapters/whoop-workout";

import { SYNTHETIC_WHOOP_PAYLOAD } from "./fixtures/synthetic-sync-payload";

const WHOOP = "http://opentwin.ch/fhir/CodeSystem/whoop";
const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const SYNTHETIC_SUBJECT = "synthetic-wearer-1";
/** LOINC 41981-2 as provider-oura emits it for one workout. */
const CALORIES_BURNED = { system: LOINC, code: "41981-2", display: "Calories burned" };

const bundle = buildWhoopFhirBundle(SYNTHETIC_WHOOP_PAYLOAD, {
  subjectKey: SYNTHETIC_SUBJECT,
  timestamp: "2026-01-05T00:00:00Z",
});

const observations = (bundle.entry ?? [])
  .map((e) => e.resource)
  .filter((r): r is Observation => r?.resourceType === "Observation");

const row = (o: Observation) => ({
  code: (o.code.coding ?? []).map((c) => `${c.system}|${c.code}`),
  effective: o.effectiveDateTime ?? o.effectivePeriod,
  value: o.valueQuantity ?? null,
});

describe("provider-whoop FHIR bundle golden", () => {
  test("Patient first, then observations in mapper order", () => {
    expect((bundle.entry ?? []).map((e) => e.resource?.resourceType)).toEqual([
      "Patient",
      ...Array.from({ length: 12 }, () => "Observation"),
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
      {
        code: [`${WHOOP}|workout`],
        effective: { start: "2026-01-02T17:00:00.000Z", end: "2026-01-02T17:45:30.000Z" },
        value: null,
      },
      {
        code: [`${WHOOP}|workout`],
        effective: { start: "2026-01-02T19:00:00.000Z", end: "2026-01-02T19:30:00.000Z" },
        value: null,
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

  test("a workout is a grouper with strain, HR, energy, distance and zone components", () => {
    const workout = observations[10];
    expect(workout?.code.text).toBe("running");
    expect(workout?.dataAbsentReason?.coding?.[0]?.code).toBe("not-applicable");
    expect(workout?.identifier).toEqual([
      { system: "http://opentwin.ch/fhir/sid/whoop", value: "workout-a" },
    ]);
    expect(
      workout?.component?.map((c) => [
        (c.code.coding ?? []).map((x) => `${x.system}|${x.code}`).join(","),
        c.valueQuantity?.value,
        c.valueQuantity?.code,
      ]),
    ).toEqual([
      [`${WHOOP}|workout-strain`, 12.34, "{score}"],
      [`${WHOOP}|workout-average-heart-rate`, 148, "/min"],
      [`${WHOOP}|workout-max-heart-rate`, 176, "/min"],
      [`${LOINC}|41981-2`, 500, "kcal"],
      [`${WHOOP}|workout-distance`, 8012.6, "m"],
      [`${WHOOP}|workout-hr-zone-0`, 60_000, "ms"],
      [`${WHOOP}|workout-hr-zone-1`, 300_000, "ms"],
      [`${WHOOP}|workout-hr-zone-2`, 600_000, "ms"],
      [`${WHOOP}|workout-hr-zone-3`, 900_000, "ms"],
      [`${WHOOP}|workout-hr-zone-4`, 720_000, "ms"],
      [`${WHOOP}|workout-hr-zone-5`, 150_000, "ms"],
    ]);
  });

  test("absent workout fields leave their component out; unscored workouts are skipped", () => {
    const second = observations[11];
    expect(
      second?.component?.map((c) => [
        (c.code.coding ?? []).map((x) => x.code).join(","),
        c.valueQuantity?.value,
      ]),
    ).toEqual([
      ["workout-strain", 6],
      ["41981-2", 191.2],
    ]);
    expect(observations.filter((o) => o.code.text === "functional-fitness")).toEqual([]);
  });

  test("workouts alone still get a Patient for their subject", () => {
    const only = buildWhoopFhirBundle(
      { recovery: [], cycles: [], sleep: [], workouts: SYNTHETIC_WHOOP_PAYLOAD.workouts },
      { subjectKey: SYNTHETIC_SUBJECT, timestamp: "2026-01-05T00:00:00Z" },
    );
    expect((only.entry ?? []).map((e) => e.resource?.resourceType)).toEqual([
      "Patient",
      "Observation",
      "Observation",
    ]);
    const patientUrl = only.entry?.[0]?.fullUrl;
    const workout = only.entry?.[1]?.resource as Observation;
    expect(workout.subject?.reference).toBe(patientUrl);
  });

  test("every emitted LOINC coding is a reviewed code", () => {
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
      CALORIES_BURNED,
      CALORIES_BURNED,
    ]);
  });
});

describe("fetchWhoopWorkouts", () => {
  test("follows next_token and keeps the window on every page", async () => {
    const original = globalThis.fetch;
    const seen: URL[] = [];
    const pages = [
      { records: [SYNTHETIC_WHOOP_PAYLOAD.workouts[0]], next_token: "page-2" },
      { records: [SYNTHETIC_WHOOP_PAYLOAD.workouts[1]], next_token: null },
    ];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(new URL(String(input)));
      return new Response(JSON.stringify(pages[seen.length - 1]), { status: 200 });
    }) as typeof fetch;
    try {
      const rows = await fetchWhoopWorkouts("synthetic-access", {
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-04T23:59:59.999Z",
      });
      expect(rows.map((r) => r.id)).toEqual(["workout-a", "workout-b"]);
      expect(seen.map((u) => u.pathname)).toEqual([
        "/developer/v2/activity/workout",
        "/developer/v2/activity/workout",
      ]);
      expect(seen.map((u) => u.searchParams.get("nextToken"))).toEqual([null, "page-2"]);
      expect(seen[1]?.searchParams.get("start")).toBe("2026-01-01T00:00:00.000Z");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a failed response throws instead of returning rows", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch;
    try {
      await expect(
        fetchWhoopWorkouts("synthetic-access", { start: "a", end: "b" }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = original;
    }
  });
});
