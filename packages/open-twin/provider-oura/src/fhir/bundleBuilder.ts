/**
 * WHAT: Orchestrates fetch/parse/map (or map-only) into a FHIR Bundle result.
 * NOT:  Must not swallow partial failures; issues go to OperationOutcome (ADR 0006).
GOVERNED BY: DECISIONS.md#d5; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator on emitted bundles in CI; terminology/unit gates on source codings.
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
import type { RequestParams } from '../api/schemas/client';
import { type RequestOuraDataOptions, requestOuraData } from '../utils/clientUtils';
import { parseOuraResponse } from '../utils/objectUtils';
import type { TokenHandler } from '../utils/tokenUtils';
import type { OuraTypedData } from '../utils/typeUtils';
import { mapOuraCardiovascularAgeToFHIR } from './mappers/cardiovascular';
import { mapOuraDailyActivityToFHIR } from './mappers/daily';
import { mapOuraHeartRateToFHIR } from './mappers/heartrate';
import { mapOuraPersonalToFHIR } from './mappers/personal';
import { mapOuraReadinessToFHIR } from './mappers/readiness';
import { mapOuraResilienceToFHIR } from './mappers/resilience';
import { mapOuraRestModeToFHIR } from './mappers/restmode';
import { mapOuraRingConfigToFHIR } from './mappers/ringconfig';
import { mapOuraSessionToFHIR } from './mappers/session';
import { CONNECTOR, type OuraMapperContext } from './mappers/shared';
import { mapOuraSleepToFHIR } from './mappers/sleep';
import { mapOuraSpo2ToFHIR } from './mappers/spo2';
import { mapOuraStressToFHIR } from './mappers/stress';
import { mapOuraVO2MaxToFHIR } from './mappers/vo2max';
import { mapOuraWorkoutToFHIR } from './mappers/workout';

export interface OuraRequestOptions extends RequestOuraDataOptions {
  /**
   * The patient every Observation is attributed to. The connector genuinely does
   * not know who the wearer is, so an integrator that does should say so (D1).
   */
  subject?: Reference;
  /**
   * Oura's own user id, or another stable key. Used to derive resource ids, and
   * to derive a `urn:uuid:` subject when `subject` is not supplied. Defaults to
   * the id from `personal_info` when that type is part of the request.
   */
  subjectKey?: string;
  /** Bundle.timestamp. Supplied by the caller so bundles are reproducible. */
  timestamp?: string;
}

export interface OuraDataResult {
  /** Successfully parsed responses, in request order. */
  data: OuraTypedData[];
  /** Types that failed or came back empty. Absent when everything succeeded. */
  issues?: OperationOutcome;
}

export interface OuraBundleResult {
  bundle: Bundle;
  issues?: OperationOutcome;
}

/**
 * Fetches and parses every requested type, without letting one failure discard
 * the others (D6). A rejected `Promise.all` used to throw away four successful
 * responses because the fifth was rate-limited.
 */
export async function fetchOuraTypedData(
  request: RequestParams,
  tokenHandler: TokenHandler,
  options: OuraRequestOptions = {}
): Promise<{ data: OuraTypedData[]; errors: ConnectorError[]; emptyTypes: string[] }> {
  const responses = await requestOuraData(request, tokenHandler, options);

  const data: OuraTypedData[] = [];
  const errors: ConnectorError[] = [];
  const emptyTypes: string[] = [];

  for (const response of responses) {
    if (response.error) {
      errors.push(response.error);
      continue;
    }
    try {
      const parsed = parseOuraResponse(response.type, response.body);
      if (parsed.type !== 'personal_info' && parsed.data.data.length === 0) {
        // "Requested and empty" and "never requested" used to be indistinguishable
        // in the output. It is a normal outcome, so it is information, not an error.
        emptyTypes.push(parsed.type);
      }
      data.push(parsed);
    } catch (error) {
      errors.push(
        error instanceof ConnectorError
          ? error
          : new ConnectorError('Response could not be parsed', {
              code: 'validation',
              connector: CONNECTOR.connector,
              operation: `GET usercollection/${response.type}`
            })
      );
    }
  }

  return { data, errors, emptyTypes };
}

export function collectIssues(errors: ConnectorError[], emptyTypes: string[]): OperationOutcome | undefined {
  const issue: OperationOutcomeIssue[] = [
    ...(toOperationOutcome(errors)?.issue ?? []),
    ...emptyTypes.map<OperationOutcomeIssue>((type) => ({
      severity: 'information',
      code: 'not-found',
      diagnostics: `No ${type} data in the requested window.`
    }))
  ];
  return issue.length > 0 ? { resourceType: 'OperationOutcome', issue } : undefined;
}

/**
 * Used only when the caller supplies no timestamp. Fixed rather than `new Date()`
 * so a bundle stays reproducible and a test cannot pass by accident of the clock.
 */
const DEFAULT_RETRIEVED_AT = '1970-01-01T00:00:00Z';

function resolveContext(data: OuraTypedData[], options: OuraRequestOptions): OuraMapperContext {
  const personal = data.find(
    (item): item is Extract<OuraTypedData, { type: 'personal_info' }> => item.type === 'personal_info'
  );
  const subjectKey = options.subjectKey ?? personal?.data.id ?? options.subject?.reference;

  if (!subjectKey) {
    throw new ConnectorError(
      'Cannot attribute Observations: supply `subject` or `subjectKey`, or include `personal_info` in the request',
      { code: 'validation', connector: CONNECTOR.connector, operation: 'buildBundle' }
    );
  }

  return {
    subject: subjectReference({ reference: options.subject, connector: CONNECTOR.connector, subjectKey }),
    subjectKey,
    retrievedAt: options.timestamp ?? DEFAULT_RETRIEVED_AT
  };
}

function mapTyped(item: OuraTypedData, context: OuraMapperContext): FhirResource[] {
  // Exhaustive over the discriminated union: adding a scope without a case here is
  // a compile error, which is what the `string`-typed switch could never give.
  switch (item.type) {
    case 'personal_info':
      return mapOuraPersonalToFHIR(item.data, context);
    case 'daily_activity':
      return mapOuraDailyActivityToFHIR(item.data, context);
    case 'heartrate':
      return mapOuraHeartRateToFHIR(item.data, context);
    case 'sleep':
      return mapOuraSleepToFHIR(item.data, context);
    case 'daily_spo2':
      return mapOuraSpo2ToFHIR(item.data, context);
    case 'workout':
      return mapOuraWorkoutToFHIR(item.data, context);
    case 'daily_cardiovascular_age':
      return mapOuraCardiovascularAgeToFHIR(item.data, context);
    case 'vO2_max':
      return mapOuraVO2MaxToFHIR(item.data, context);
    case 'daily_readiness':
      return mapOuraReadinessToFHIR(item.data, context);
    case 'daily_resilience':
      return mapOuraResilienceToFHIR(item.data, context);
    case 'daily_stress':
      return mapOuraStressToFHIR(item.data, context);
    case 'rest_mode_period':
      return mapOuraRestModeToFHIR(item.data, context);
    case 'ring_configuration':
      return mapOuraRingConfigToFHIR(item.data, context);
    case 'session':
      return mapOuraSessionToFHIR(item.data, context);
  }
}

/** Builds one flat collection bundle from every requested type. */
export function buildOuraBundle(
  data: OuraTypedData[],
  request: RequestParams,
  options: OuraRequestOptions = {}
): Bundle {
  const context = resolveContext(data, options);
  const mapped = data.flatMap((item) => mapTyped(item, context));

  // `personal_info` is what normally puts the Patient in the bundle. The sandbox
  // returns 404 for it, and a caller can simply not request it, so without this every
  // Observation referenced a Patient that was not there.
  //
  // Only when the reference was minted here and something actually uses it. A caller
  // who supplied their own `subject` is pointing at a Patient in their own system, and
  // a second one under our id would fork one person into two. A sync that returned
  // nothing — a 401, or an empty window — must stay empty rather than assert that a
  // person exists about whom we observed nothing.
  const hasPatient = mapped.some((resource) => resource.resourceType === 'Patient');
  const referencesSubject = mapped.some((resource) => {
    // `subject` is a Reference on most resource types and a Reference[] on a few, so
    // it is normalised rather than assumed.
    const subject = 'subject' in resource ? (resource.subject as Reference | Reference[] | undefined) : undefined;
    const references = Array.isArray(subject) ? subject : subject ? [subject] : [];
    return references.some((entry) => entry.reference === context.subject.reference);
  });
  const resources =
    hasPatient || options.subject || !referencesSubject
      ? mapped
      : [
          minimalPatient({
            connector: CONNECTOR.connector,
            subjectKey: context.subjectKey,
            identifierSystem: SYSTEMS.OURA_IDENTIFIER
          }),
          ...mapped
        ];

  return buildBundle({
    connector: CONNECTOR,
    resources,
    timestamp: options.timestamp ?? new Date().toISOString(),
    // Re-running the same sync for the same window yields the same Bundle.id.
    bundleKey: [
      CONNECTOR.connector,
      context.subjectKey,
      [...request.types].sort().join(','),
      request.start_date ?? '',
      request.end_date ?? ''
    ].join('|')
  });
}

export async function buildBundleFromResponse(
  request: RequestParams,
  tokenHandler: TokenHandler,
  options: OuraRequestOptions = {}
): Promise<OuraBundleResult> {
  const { data, errors, emptyTypes } = await fetchOuraTypedData(request, tokenHandler, options);
  return { bundle: buildOuraBundle(data, request, options), issues: collectIssues(errors, emptyTypes) };
}
