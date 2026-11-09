import { describe, expect, test } from "bun:test";

import { deterministicId, patientUuid, SYSTEMS } from "@open-twin/fhir-core";
import type { OuraTypedData } from "@open-twin/provider-oura";
import type { Bundle, FhirResource, Observation, Patient } from "fhir/r4";

import { SYNTHETIC_GOOGLE_HEALTH_RESPONSES } from "@/features/google-health/fixtures/synthetic-sync-responses";
import { SYNTHETIC_OURA_DATA } from "@/features/oura/fixtures/synthetic-sync-data";
import { SYNTHETIC_WHOOP_PAYLOAD } from "@/features/whoop/fixtures/synthetic-sync-payload";

import { aggregateWearableBundles } from "@/infrastructure/open-twin-adapters/aggregate";
import { buildGoogleHealthFhirBundle } from "@/infrastructure/open-twin-adapters/google-health";
import { buildOuraFhirBundle } from "@/infrastructure/open-twin-adapters/oura";
import { buildWhoopFhirBundle } from "@/infrastructure/open-twin-adapters/whoop";

const SYNTHETIC_SUBJECT = "synthetic-wearer-1";
const OTHER_SYNTHETIC_SUBJECT = "synthetic-wearer-2";
const TIMESTAMP = "2026-01-05T00:00:00Z";
const options = { subjectKey: SYNTHETIC_SUBJECT, timestamp: TIMESTAMP };
const ouraRequest = {
  types: ["workout", "daily_spo2", "daily_stress", "vO2_max"],
  start_date: "2026-01-01",
  end_date: "2026-01-04",
} as const;

const oura = buildOuraFhirBundle(SYNTHETIC_OURA_DATA, ouraRequest, options);
const whoop = buildWhoopFhirBundle(SYNTHETIC_WHOOP_PAYLOAD, options);

const resourcesOf = (bundle: Bundle): FhirResource[] =>
  (bundle.entry ?? []).flatMap((entry) =>
    entry.resource ? [entry.resource as FhirResource] : [],
  );
const resourceIds = (bundle: Bundle) => resourcesOf(bundle).map((r) => r.id);
const observationsOf = (bundle: Bundle) =>
  resourcesOf(bundle).filter((r): r is Observation => r.resourceType === "Observation");
const patientsOf = (bundle: Bundle) =>
  resourcesOf(bundle).filter((r): r is Patient => r.resourceType === "Patient");
const subjectsOf = (bundle: Bundle) =>
  new Set(observationsOf(bundle).map((o) => o.subject?.reference));

describe("aggregateWearableBundles", () => {
  test("one source: every resource carried through, nothing reconciled", () => {
    const { bundle, reconciliations } = aggregateWearableBundles({
      oura: null,
      whoop,
      ...options,
    });
    expect(resourceIds(bundle)).toEqual(resourceIds(whoop));
    expect(reconciliations).toEqual([]);
  });

  test("Oura and WHOOP for one person name one subject, and aggregate accepts them", () => {
    expect([...subjectsOf(oura)]).toEqual([...subjectsOf(whoop)]);
    expect(subjectsOf(oura).size).toBe(1);

    const { bundle } = aggregateWearableBundles({ oura, whoop, ...options });
    const observations = observationsOf(bundle);
    expect(observations.length).toBeGreaterThanOrEqual(
      observationsOf(oura).length + observationsOf(whoop).length,
    );
    expect(subjectsOf(bundle).size).toBe(1);
  });

  test("the person's Patient is carried once, resolves the subject, and keeps each connector's identifier", () => {
    const { bundle } = aggregateWearableBundles({ oura, whoop, ...options });
    const [patient, ...others] = patientsOf(bundle);
    expect(others).toEqual([]);
    expect(patient?.identifier).toEqual([
      { system: SYSTEMS.OURA_IDENTIFIER, value: SYNTHETIC_SUBJECT },
      { system: SYSTEMS.WHOOP_IDENTIFIER, value: SYNTHETIC_SUBJECT },
    ]);
    const patientUrl = bundle.entry?.find((e) => e.resource === patient)?.fullUrl;
    expect([...subjectsOf(bundle)]).toEqual([patientUrl]);
  });

  test("the shared subject is not either connector's patient id", () => {
    const [subject] = [...subjectsOf(oura)];
    expect(subject).not.toBe(`urn:uuid:${patientUuid("oura", SYNTHETIC_SUBJECT)}`);
    expect(subject).not.toBe(`urn:uuid:${patientUuid("whoop", SYNTHETIC_SUBJECT)}`);
  });

  test("Observation ids still carry their connector", () => {
    const { bundle } = aggregateWearableBundles({ oura, whoop, ...options });
    const ids = new Set(resourceIds(bundle));
    expect(
      ids.has(
        deterministicId({
          connector: "whoop",
          subjectKey: SYNTHETIC_SUBJECT,
          recordId: "workout-a",
          measure: "workout",
        }),
      ),
    ).toBe(true);
    expect(observationsOf(oura).map((o) => o.id)).toEqual(
      observationsOf(
        aggregateWearableBundles({ oura, whoop: null, ...options }).bundle,
      ).map((o) => o.id),
    );
  });

  test("Oura's own Patient from personal_info keeps its per-connector id and is linked", () => {
    const personal: OuraTypedData = {
      type: "personal_info",
      data: { id: "synthetic-oura-user", age: 40 },
    } as OuraTypedData;
    const withPersonal = buildOuraFhirBundle(
      [personal, ...SYNTHETIC_OURA_DATA],
      { ...ouraRequest, types: ["personal_info", ...ouraRequest.types] },
      options,
    );
    const ouraPatientId = patientUuid("oura", "synthetic-oura-user");
    const { bundle } = aggregateWearableBundles({
      oura: withPersonal,
      whoop,
      ...options,
    });
    const patients = patientsOf(bundle);
    expect(patients.map((p) => p.id)).toContain(ouraPatientId);
    expect(patients.flatMap((p) => p.link ?? [])).toEqual([
      { other: { reference: `urn:uuid:${ouraPatientId}` }, type: "seealso" },
    ]);
    expect(subjectsOf(bundle).size).toBe(1);
  });

  test("bundles of two different people are still refused", () => {
    const other = buildWhoopFhirBundle(SYNTHETIC_WHOOP_PAYLOAD, {
      ...options,
      subjectKey: OTHER_SYNTHETIC_SUBJECT,
    });
    expect(() => aggregateWearableBundles({ oura, whoop: other, ...options })).toThrow(
      "Cannot reconcile across 2 different subjects",
    );
  });

  test("no bundle at all is refused", () => {
    expect(() =>
      aggregateWearableBundles({ oura: null, whoop: null, ...options }),
    ).toThrow("Cannot aggregate nothing");
  });
});

describe("aggregateWearableBundles with Google Health", () => {
  const googleHealth = buildGoogleHealthFhirBundle(
    SYNTHETIC_GOOGLE_HEALTH_RESPONSES,
    options,
  );
  // A made-up Oura night over the same night as Google Health's (7 to 8 Jan).
  const ouraSameNight = buildOuraFhirBundle(
    [
      {
        type: "sleep",
        data: {
          next_token: null,
          data: [
            {
              id: "sleep-synthetic-same-night",
              day: "2026-01-08",
              type: "long_sleep",
              bedtime_start: "2026-01-07T23:30:00+01:00",
              bedtime_end: "2026-01-08T07:00:00+01:00",
              total_sleep_duration: 26_400,
            },
          ],
        },
      } as OuraTypedData,
    ],
    { types: ["sleep"], start_date: "2026-01-07", end_date: "2026-01-08" },
    options,
  );

  test("Google Health names the same subject as Oura and WHOOP, not its own patient id", () => {
    expect([...subjectsOf(googleHealth)]).toEqual([...subjectsOf(oura)]);
    expect([...subjectsOf(googleHealth)]).not.toContain(
      `urn:uuid:${patientUuid("google-health", SYNTHETIC_SUBJECT)}`,
    );
    expect(patientsOf(googleHealth).map((p) => p.identifier)).toEqual([
      [{ system: SYSTEMS.GOOGLE_HEALTH_IDENTIFIER, value: SYNTHETIC_SUBJECT }],
    ]);
  });

  test("all three for one person are accepted: every source Observation kept, one Patient with three identifiers", () => {
    const { bundle } = aggregateWearableBundles({
      oura,
      whoop,
      googleHealth,
      ...options,
    });
    const kept = new Set(observationsOf(bundle).map((o) => o.id));
    for (const source of [oura, whoop, googleHealth]) {
      for (const observation of observationsOf(source)) {
        expect(kept.has(observation.id)).toBe(true);
      }
    }
    expect(subjectsOf(bundle).size).toBe(1);
    expect(patientsOf(bundle).map((p) => p.identifier?.map((i) => i.system))).toEqual([
      [
        SYSTEMS.OURA_IDENTIFIER,
        SYSTEMS.WHOOP_IDENTIFIER,
        SYSTEMS.GOOGLE_HEALTH_IDENTIFIER,
      ],
    ]);
  });

  test("Google Health of another person is refused", () => {
    const other = buildGoogleHealthFhirBundle(SYNTHETIC_GOOGLE_HEALTH_RESPONSES, {
      ...options,
      subjectKey: OTHER_SYNTHETIC_SUBJECT,
    });
    expect(() =>
      aggregateWearableBundles({ oura, whoop: null, googleHealth: other, ...options }),
    ).toThrow("Cannot reconcile across 2 different subjects");
  });

  // At the pinned open-twin, Oura's and Google Health's sleep duration are
  // components of a sleep panel (Oura code / Google local code), and aggregate
  // matches on Observation.code only, so one night from two sources is not seen
  // as an overlap. Nothing is selected; the screens' fixed source order still
  // decides. When upstream reads components this test fails on purpose.
  test("the same night from Oura and Google Health: no overlap is found yet", () => {
    const ouraNight = observationsOf(ouraSameNight)[0];
    const googleNight = observationsOf(googleHealth).find(
      (o) => o.code.coding?.[0]?.code === "sleep",
    );
    const day = (o: Observation | undefined) =>
      (o?.effectiveDateTime ?? o?.effectivePeriod?.start ?? "").slice(0, 10);
    expect(day(ouraNight)).toBe("2026-01-07");
    expect(day(googleNight)).toBe(day(ouraNight));
    // Both carry sleep duration (LOINC 93832-4), only as a component.
    const componentCodes = (o: Observation | undefined) =>
      (o?.component ?? []).flatMap(
        (c) => c.code.coding?.map((coding) => coding.code) ?? [],
      );
    expect(componentCodes(ouraNight)).toContain("93832-4");
    expect(componentCodes(googleNight)).toContain("93832-4");

    const { bundle, reconciliations } = aggregateWearableBundles({
      oura: ouraSameNight,
      whoop,
      googleHealth,
      ...options,
    });
    expect(reconciliations).toEqual([]);
    expect(observationsOf(bundle).length).toBe(
      observationsOf(ouraSameNight).length +
        observationsOf(whoop).length +
        observationsOf(googleHealth).length,
    );
  });
});
