/**
 * Turns one subject's synthetic series into a FHIR R4 collection Bundle that
 * `bun run warehouse:ingest` accepts: the subject's own Synthea Patient (so the
 * rows land on the same `subject_ref` and cohort) plus one Observation per
 * reading. Every resource is tagged as test data (HL7 v3 ActReason `HTEST`)
 * and as coming from this generator. Pure.
 */
import { createHash } from "node:crypto";

import { type DailyReading, WEARABLE_METRICS } from "./series";
import { WORKOUT_METRICS, type WorkoutReading } from "./workouts";

export const GENERATOR_ID = "twinllm-synthetic-wearables";
/** 2: workouts (`workout-<sport>`, minutes) beside the daily series, which is unchanged. */
export const WEARABLE_GENERATOR_VERSION = "2";

const SYNTHEA_IDENTIFIER_SYSTEM = "https://github.com/synthetichealth/synthea";
const UCUM = "http://unitsofmeasure.org";
const CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";

export const SYNTHETIC_TAGS = [
  {
    system: "http://terminology.hl7.org/CodeSystem/v3-ActReason",
    code: "HTEST",
    display: "test health data",
  },
  { system: "urn:twinllm:generator", code: GENERATOR_ID },
] as const;

type Identifier = Readonly<{ system?: unknown; value?: unknown }>;

/** The parts of a Synthea Patient the wearable bundle copies. */
export type SyntheaPatient = Readonly<{
  resourceType: "Patient";
  id: string;
  identifier: readonly Identifier[];
  deceased: boolean;
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The Synthea Patient in a bundle, or null when there is none. */
export const syntheaPatientOf = (bundle: unknown): SyntheaPatient | null => {
  if (!isObject(bundle) || !Array.isArray(bundle.entry)) return null;
  const resource = bundle.entry
    .map((entry: unknown) => (isObject(entry) ? entry.resource : undefined))
    .find(
      (item): item is Record<string, unknown> =>
        isObject(item) && item.resourceType === "Patient",
    );
  if (!resource || typeof resource.id !== "string") return null;
  const identifier = Array.isArray(resource.identifier)
    ? resource.identifier.filter(isObject)
    : [];
  if (!identifier.some((item) => item.system === SYNTHEA_IDENTIFIER_SYSTEM)) return null;
  return {
    resourceType: "Patient",
    id: resource.id,
    // Only Synthea's own identifier is copied; names, addresses and other
    // made-up demographics stay in the Synthea bundle.
    identifier: identifier
      .filter((item) => item.system === SYNTHEA_IDENTIFIER_SYSTEM)
      .map((item) => ({ system: item.system, value: item.value })),
    deceased:
      resource.deceasedDateTime !== undefined || resource.deceasedBoolean === true,
  };
};

/** A UUID-shaped id from a stable key, so re-runs give the same ids. */
export const stableUuid = (key: string): string => {
  const hex = createHash("sha256").update(key).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
};

const METRICS = { ...WEARABLE_METRICS, ...WORKOUT_METRICS } as const;

export type SeriesReading = DailyReading | WorkoutReading;

const observationOf = (patientId: string, reading: SeriesReading) => {
  const metric = METRICS[reading.metric];
  const id = stableUuid(`${GENERATOR_ID}:${patientId}:${reading.metric}:${reading.day}`);
  return {
    fullUrl: `urn:uuid:${id}`,
    resource: {
      resourceType: "Observation",
      id,
      meta: { tag: SYNTHETIC_TAGS },
      status: "final",
      category: [{ coding: [{ system: CATEGORY, code: metric.category }] }],
      code: {
        coding: [{ system: metric.system, code: metric.code, display: metric.display }],
        text: metric.display,
      },
      subject: { reference: `urn:uuid:${patientId}` },
      effectiveDateTime: `${reading.day}T${metric.time}Z`,
      valueQuantity: {
        value: reading.value,
        unit: metric.unitLabel,
        system: UCUM,
        code: metric.unit,
      },
    },
  };
};

export const wearableBundle = (
  patient: SyntheaPatient,
  readings: readonly SeriesReading[],
) => ({
  resourceType: "Bundle",
  id: stableUuid(`${GENERATOR_ID}:${patient.id}:bundle`),
  meta: { tag: SYNTHETIC_TAGS },
  type: "collection",
  entry: [
    {
      fullUrl: `urn:uuid:${patient.id}`,
      resource: {
        resourceType: "Patient",
        id: patient.id,
        meta: { tag: SYNTHETIC_TAGS },
        identifier: patient.identifier,
      },
    },
    ...readings.map((reading) => observationOf(patient.id, reading)),
  ],
});
