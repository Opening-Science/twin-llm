// One BodyLoop scan as FHIR, through @open-twin/provider-vitronic. The host
// keeps its own Bearer client and TLS pin (packages/vitronic/); only the
// mapping comes from upstream, from lists the host already fetched. The bundle
// sits under the person's shared subject (person-subject.ts), never a proband
// id. No server-only so tests can build a bundle from a fixture.
import { SYSTEMS } from "@open-twin/fhir-core";
import { buildBundleFromVitronicResponse } from "@open-twin/provider-vitronic";
import {
  MEASUREMENT_SCHEMAS,
  type MeasurementData,
} from "@open-twin/provider-vitronic/api/schemas/shared";
import type { Bundle } from "fhir/r4";

import { personSubject, withPersonPatient } from "./person-subject";

/** The seven BodyLoop measurement lists, in the provider's names. */
export type VitronicScope = keyof typeof MEASUREMENT_SCHEMAS;

export const VITRONIC_SCOPES = Object.keys(
  MEASUREMENT_SCHEMAS,
) as readonly VitronicScope[];

export type VitronicScanLists = Readonly<Partial<Record<VitronicScope, unknown>>>;

export type VitronicFhirResult = Readonly<{
  bundle: Bundle;
  /** Lists that did not match the provider's schema; they add nothing to the bundle. */
  dropped: readonly VitronicScope[];
}>;

const OFFSET_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * A FHIR dateTime from the scanner's `crtime`. A time without an offset keeps
 * only its date, as upstream's own fetch path does: no offset is invented.
 */
export const scanDateTime = (value: string | null | undefined): string | undefined => {
  const text = value?.trim();
  if (!text) return undefined;
  if (OFFSET_DATE_TIME.test(text) || DATE_ONLY.test(text)) return text;
  return LOCAL_DATE_TIME.exec(text)?.[1];
};

type ParsedLists = { [S in VitronicScope]?: MeasurementData<S> };

const parseLists = (lists: VitronicScanLists) => {
  const parsed: ParsedLists = {};
  const dropped: VitronicScope[] = [];
  for (const scope of VITRONIC_SCOPES) {
    const raw = lists[scope];
    if (raw === undefined || raw === null) continue;
    const result = MEASUREMENT_SCHEMAS[scope].safeParse(raw);
    if (result.success) Object.assign(parsed, { [scope]: result.data });
    else dropped.push(scope);
  }
  return { parsed, dropped };
};

/**
 * Every Observation names the person's subject (`subjectKey` is the host's
 * key, e.g. a VitronicSubject id). The scan id seeds the Observation ids, so
 * syncing the same scan again gives the same resources.
 */
export const buildVitronicFhirBundle = (
  scan: Readonly<{
    scanId: string;
    effectiveDateTime?: string | null;
    lists: VitronicScanLists;
  }>,
  options: Readonly<{ subjectKey: string; timestamp: string }>,
): VitronicFhirResult => {
  const { parsed, dropped } = parseLists(scan.lists);
  const effectiveDateTime = scanDateTime(scan.effectiveDateTime);
  const bundle = buildBundleFromVitronicResponse({
    scan_id: scan.scanId,
    subject: personSubject(options.subjectKey),
    subjectKey: options.subjectKey,
    timestamp: options.timestamp,
    ...(effectiveDateTime ? { effectiveDateTime } : {}),
    ...parsed,
  });
  return {
    bundle: withPersonPatient(bundle, {
      subjectKey: options.subjectKey,
      identifierSystem: SYSTEMS.VITRONIC_IDENTIFIER,
    }),
    dropped,
  };
};
