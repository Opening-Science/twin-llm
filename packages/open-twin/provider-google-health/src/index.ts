/**
 * WHAT: Package public barrel: re-exports the supported API surface.
 * NOT:  Must not contain mapping or clinical logic; implementation lives in sibling modules.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError, toOperationOutcome } from '@open-twin/fhir-core';
import type { Bundle, OperationOutcome, Reference } from 'fhir/r4';
import { Auth, type health_v4 } from 'googleapis';
import { GoogleHealthClient } from './api/client';
import type { AllTypes } from './api/record_types';
import { buildBundleFromResponses } from './fhir/bundleBuilder';

export type { AllType, QueryWindow } from './api/record_types';
export {
  ALL_TYPES,
  buildTypeFilter,
  DAILY_TYPES,
  INTERVAL_TYPES,
  resolveWindow,
  SAMPLE_TYPES,
  SESSION_TYPES
} from './api/record_types';
export type { BuildBundleOptions, BundleResult } from './fhir/bundleBuilder';
export { buildBundleFromResponses, mapDataPointToFHIR } from './fhir/bundleBuilder';
// biome-ignore lint/style/useExportType: Exposing the type and GoogleHealthClient class is necessary for external usage
export { AllTypes, GoogleHealthClient };

export function getGoogleHealthAuthUrl(client: GoogleHealthClient): string {
  return client.getAuthUrl();
}

export async function initializeGoogleHealthClient(
  client: GoogleHealthClient,
  code: string
): Promise<Auth.Credentials> {
  return await client.initialize(code);
}

export interface GetDataTypesRequest {
  client: GoogleHealthClient;
  types: AllTypes;
  start_date?: string;
  end_date?: string;
  /** IANA zone the subject's civil dates are computed in, e.g. 'Europe/Zurich'. */
  timeZone?: string;
}

export interface GetDataTypesResult {
  responses: health_v4.Schema$ListDataPointsResponse[];
  /** Decision D6: absence of data is not an exception, and one failure is not all of them. */
  issues?: OperationOutcome;
}

export async function getDataTypes({
  client,
  types,
  start_date,
  end_date,
  timeZone
}: GetDataTypesRequest): Promise<GetDataTypesResult> {
  const auth = client.getClient().context._options.auth;

  if (!auth || !(auth instanceof Auth.OAuth2Client)) {
    throw new ConnectorError('An authenticated OAuth2Client is required', {
      code: 'auth',
      connector: 'google-health',
      operation: 'getDataTypes'
    });
  }

  // `getAccessToken()` returns a Promise, and a Promise object is always truthy — the
  // previous `if (!auth.getAccessToken())` guard could never fire, so an unauthenticated
  // client sailed past it and failed later with an opaque Google error. The promise was
  // also never awaited, so a rejected refresh became an unhandled rejection.
  const { token } = await auth.getAccessToken();
  if (!token) {
    throw new ConnectorError(
      'Access token is required. Authenticate the client first using initializeGoogleHealthClient.',
      { code: 'auth', connector: 'google-health', operation: 'getDataTypes' }
    );
  }

  const { responses, errors } = await client.getTypes({ types, start_date, end_date, timeZone });
  return { responses, issues: toOperationOutcome(errors) };
}

export interface GetFhirBundleRequest extends GetDataTypesRequest {
  /**
   * The vendor's own user identifier, used to derive stable resource ids and a
   * `urn:uuid:` subject. Never an email address or any other PII.
   */
  subjectKey: string;
  /** A caller-supplied subject. Used verbatim when present; no Patient is invented. */
  subject?: Reference;
  /** ISO 8601. Supply it to make a bundle reproducible. */
  timestamp?: string;
  bundleType?: 'collection' | 'transaction';
}

export interface GetFhirBundleResult {
  bundle: Bundle;
  issues?: OperationOutcome;
  /** Declared data types that arrived and were dropped. Empty is the healthy case. */
  unmapped: string[];
}

export async function getFhirBundleFromGoogleHealthData({
  client,
  types,
  start_date,
  end_date,
  timeZone,
  subjectKey,
  subject,
  timestamp,
  bundleType
}: GetFhirBundleRequest): Promise<GetFhirBundleResult> {
  const { responses, issues } = await getDataTypes({ client, types, start_date, end_date, timeZone });
  const { bundle, unmapped } = buildBundleFromResponses(responses, {
    subjectKey,
    subject,
    timestamp,
    type: bundleType
  });

  return { bundle, issues, unmapped };
}
