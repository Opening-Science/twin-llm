import { describe, expect, test } from "bun:test";

import { deterministicId, patientUuid, SYSTEMS } from "@open-twin/fhir-core";
import type { OuraTypedData } from "@open-twin/provider-oura";
import type { Bundle, FhirResource, Observation, Patient } from "fhir/r4";

import { SYNTHETIC_OURA_DATA } from "@/features/oura/fixtures/synthetic-sync-data";
import { SYNTHETIC_WHOOP_PAYLOAD } from "@/features/whoop/fixtures/synthetic-sync-payload";

import { aggregateWearableBundles } from "@/infrastructure/open-twin-adapters/aggregate";
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
