// Upstream exports only the fetch-and-build entry points from the barrel. The host
// already holds the parsed data from `getOuraData`, so the pure builder is imported
// from the synced checkout (sync must not patch upstream *.ts). No server-only so
// tests can build a bundle from a fixture.
import { buildOuraBundle } from "../../.open-twin/packages/provider-oura/src/fhir/bundleBuilder";
import { SYSTEMS } from "@open-twin/fhir-core";
import type { OuraTypedData, SupportedScope } from "@open-twin/provider-oura";
import type { Bundle } from "fhir/r4";

import { personSubject, withPersonPatient } from "./person-subject";

/** Every Observation names the person's shared subject (person-subject.ts), not an Oura-only one. */
export const buildOuraFhirBundle = (
  data: readonly OuraTypedData[],
  request: {
    readonly types: readonly SupportedScope[];
    readonly start_date: string;
    readonly end_date: string;
  },
  options: { readonly subjectKey: string; readonly timestamp: string },
): Bundle =>
  withPersonPatient(
    buildOuraBundle(
      [...data],
      {
        types: [...request.types],
        start_date: request.start_date,
        end_date: request.end_date,
      },
      {
        subject: personSubject(options.subjectKey),
        subjectKey: options.subjectKey,
        timestamp: options.timestamp,
      },
    ),
    { subjectKey: options.subjectKey, identifierSystem: SYSTEMS.OURA_IDENTIFIER },
  );
