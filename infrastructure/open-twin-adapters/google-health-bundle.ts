// The Google Health bundle under the person's shared subject (person-subject.ts),
// as Oura and WHOOP already are, so `@open-twin/aggregate` accepts all three for
// one person. Built from responses the host already fetched (`getDataTypes`). No
// server-only so tests can build a bundle from a fixture.
import { SYSTEMS } from "@open-twin/fhir-core";
import { buildBundleFromResponses } from "@open-twin/provider-google-health";
import type { Bundle } from "fhir/r4";
import type { health_v4 } from "googleapis";

import { personSubject, withPersonPatient } from "./person-subject";

/** Every Observation names the person's subject, not a Google-only one. */
export const buildGoogleHealthFhirBundle = (
  responses: readonly health_v4.Schema$ListDataPointsResponse[],
  options: { readonly subjectKey: string; readonly timestamp: string },
): Bundle =>
  withPersonPatient(
    buildBundleFromResponses([...responses], {
      subject: personSubject(options.subjectKey),
      subjectKey: options.subjectKey,
      timestamp: options.timestamp,
    }).bundle,
    {
      subjectKey: options.subjectKey,
      identifierSystem: SYSTEMS.GOOGLE_HEALTH_IDENTIFIER,
    },
  );
