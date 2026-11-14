/**
 * WHAT: Orchestrates fetch/parse/map into a FHIR Bundle result.
 * NOT:  Must not swallow partial failures; issues go to OperationOutcome (D6).
GOVERNED BY: DECISIONS.md#d5; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator on emitted bundles in CI when registered; terminology/unit gates on source codings.
 */
import {
  buildBundle,
  ConnectorError,
  minimalPatient,
  SYSTEMS,
  subjectReference,
  toOperationOutcome
} from '@open-twin/fhir-core';
import type { Bundle, FhirResource, OperationOutcome, OperationOutcomeIssue, Reference } from 'fhir/r4';
import type { WhoopSyncPayload } from '../api/schemas/sync';
import { fetchWhoopSyncPayload, type WhoopWindow } from '../utils/fetchWhoopData';
import type { TokenHandler } from '../utils/tokenUtils';
import { mapWhoopCycleToFHIR } from './mappers/cycle';
import { mapWhoopRecoveryToFHIR } from './mappers/recovery';
import { CONNECTOR, type WhoopMapperContext } from './mappers/shared';
import { mapWhoopSleepToFHIR } from './mappers/sleep';

export interface WhoopRequestOptions {
  subject?: Reference;
  /** Stable wearer key — required because v1 does not fetch profile. */
  subjectKey: string;
  timestamp?: string;
}

export interface WhoopDataResult {
  data: WhoopSyncPayload;
  issues?: OperationOutcome;
}

export interface WhoopBundleResult {
  bundle: Bundle;
  issues?: OperationOutcome;
}

const DEFAULT_RETRIEVED_AT = '1970-01-01T00:00:00Z';

export function collectIssues(errors: ConnectorError[]): OperationOutcome | undefined {
  const issue: OperationOutcomeIssue[] = toOperationOutcome(errors)?.issue ?? [];
  return issue.length > 0 ? { resourceType: 'OperationOutcome', issue } : undefined;
}

function resolveContext(options: WhoopRequestOptions): WhoopMapperContext {
  return {
    subject: subjectReference({
      reference: options.subject,
      connector: CONNECTOR.connector,
      subjectKey: options.subjectKey
    }),
    subjectKey: options.subjectKey,
    retrievedAt: options.timestamp ?? DEFAULT_RETRIEVED_AT
  };
}

export function buildWhoopBundle(data: WhoopSyncPayload, options: WhoopRequestOptions): Bundle {
  const context = resolveContext(options);
  const mapped: FhirResource[] = [
    ...mapWhoopRecoveryToFHIR(data.recovery, context),
    ...mapWhoopCycleToFHIR(data.cycles, context),
    ...mapWhoopSleepToFHIR(data.sleep, context)
  ];

  const referencesSubject = mapped.some((resource) => {
    const subject = 'subject' in resource ? (resource.subject as Reference | Reference[] | undefined) : undefined;
    const references = Array.isArray(subject) ? subject : subject ? [subject] : [];
    return references.some((entry) => entry.reference === context.subject.reference);
  });

  const resources =
    options.subject || !referencesSubject
      ? mapped
      : [
          minimalPatient({
            connector: CONNECTOR.connector,
            subjectKey: context.subjectKey,
            identifierSystem: SYSTEMS.WHOOP_IDENTIFIER
          }),
          ...mapped
        ];

  return buildBundle({
    connector: CONNECTOR,
    resources,
    timestamp: options.timestamp ?? new Date().toISOString(),
    bundleKey: [CONNECTOR.connector, context.subjectKey, 'recovery,cycle,sleep'].join('|')
  });
}

export async function fetchWhoopData(
  window: WhoopWindow,
  tokenHandler: TokenHandler,
  _options: WhoopRequestOptions = { subjectKey: 'unknown' }
): Promise<WhoopDataResult> {
  const { data, errors } = await fetchWhoopSyncPayload(window, tokenHandler);
  return { data, issues: collectIssues(errors) };
}

export async function getFhirBundleFromWhoopData(
  window: WhoopWindow,
  tokenHandler: TokenHandler,
  options: WhoopRequestOptions
): Promise<WhoopBundleResult> {
  if (!options.subjectKey) {
    throw new ConnectorError('subjectKey is required', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'getFhirBundleFromWhoopData'
    });
  }
  const { data, errors } = await fetchWhoopSyncPayload(window, tokenHandler);
  return { bundle: buildWhoopBundle(data, options), issues: collectIssues(errors) };
}

export function buildWhoopBundleFromPayload(data: WhoopSyncPayload, options: WhoopRequestOptions): Bundle {
  if (!options.subjectKey) {
    throw new ConnectorError('subjectKey is required', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'buildWhoopBundleFromPayload'
    });
  }
  return buildWhoopBundle(data, options);
}
