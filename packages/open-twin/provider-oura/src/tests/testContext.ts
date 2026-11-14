import { patientUuid, subjectReference } from '@open-twin/fhir-core';
import type { OuraMapperContext } from '../fhir/mappers/shared';

/**
 * The subject every mapper test attributes its Observations to.
 *
 * Mappers no longer default to `Patient/example`, so the caller has to say who the
 * patient is — which is the whole point of D1, and means the tests have to say it
 * too.
 */
export const SUBJECT_KEY = 'oura-user-1';

/** Fixed, so a bundle is reproducible and no assertion depends on the clock. */
export const TEST_RETRIEVED_AT = '2026-06-20T08:00:00Z';

export const TEST_CONTEXT: OuraMapperContext = {
  subject: subjectReference({ connector: 'oura', subjectKey: SUBJECT_KEY }),
  subjectKey: SUBJECT_KEY,
  retrievedAt: TEST_RETRIEVED_AT
};

export const TEST_SUBJECT_REFERENCE = `urn:uuid:${patientUuid('oura', SUBJECT_KEY)}`;
