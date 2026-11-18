/**
 * A synthetic scan as a FHIR R4 Bundle that `bun run warehouse:ingest`
 * accepts: the Observations come from @open-twin/provider-vitronic (through
 * the host adapter), under the subject's own Synthea Patient, so the rows land
 * on the same `subject_ref` and cohort. Every resource is tagged as test data
 * and as coming from this generator. Pure.
 */
import { buildVitronicBundleForSubject } from "@/infrastructure/open-twin-adapters/vitronic";

import {
  stableUuid,
  SYNTHETIC_TAGS as WEARABLE_TAGS,
  type SyntheaPatient,
} from "../synthetic-wearables/bundle";
import type { SyntheticScan } from "./scan";

export const SCAN_GENERATOR_ID = "twinllm-synthetic-scans";
export const SCAN_GENERATOR_VERSION = "1";

export const SCAN_TAGS = [
  WEARABLE_TAGS[0],
  { system: "urn:twinllm:generator", code: SCAN_GENERATOR_ID },
] as const;

type Tagged = { meta?: { tag?: unknown[] } };

const tagged = <T extends Tagged>(resource: T): T => ({
  ...resource,
  meta: { ...resource.meta, tag: [...(resource.meta?.tag ?? []), ...SCAN_TAGS] },
});

/** The scan id the bundle carries: stable for one subject and visit. */
export const syntheticScanId = (patientId: string, scan: SyntheticScan): string =>
  `synthetic-${stableUuid(`${SCAN_GENERATOR_ID}:${patientId}:${scan.effectiveDateTime}`)}`;

export const syntheticScanBundle = (patient: SyntheaPatient, scan: SyntheticScan) => {
  const { bundle } = buildVitronicBundleForSubject(
    {
      scanId: syntheticScanId(patient.id, scan),
      effectiveDateTime: scan.effectiveDateTime,
      lists: { properties: scan.properties },
    },
    {
      subject: { reference: `urn:uuid:${patient.id}` },
      subjectKey: patient.id,
      timestamp: new Date(scan.effectiveDateTime).toISOString(),
    },
  );
  return {
    ...tagged(bundle),
    entry: [
      {
        fullUrl: `urn:uuid:${patient.id}`,
        resource: {
          resourceType: "Patient",
          id: patient.id,
          meta: { tag: SCAN_TAGS },
          identifier: patient.identifier,
        },
      },
      ...(bundle.entry ?? []).map((entry) => ({
        ...entry,
        ...(entry.resource ? { resource: tagged(entry.resource) } : {}),
      })),
    ],
  };
};
