import { subjectReference } from '@open-twin/fhir-core';
import type { DataPointMeta, SubjectContext } from '../../fhir/mappers/shared';

export const GOOGLE_HEALTH = 'http://opentwin.ch/fhir/CodeSystem/google-health';
export const GOOGLE_HEALTH_IDENTIFIER = 'http://opentwin.ch/fhir/sid/google-health';
export const LOINC = 'http://loinc.org';
export const UCUM_SYSTEM = 'http://unitsofmeasure.org';
export const OBSERVATION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
export const DATA_ABSENT_REASON = 'http://terminology.hl7.org/CodeSystem/data-absent-reason';

export const SUBJECT_KEY = '8338456149191909237';

export const CONTEXT: SubjectContext = {
  subject: subjectReference({ connector: 'google-health', subjectKey: SUBJECT_KEY }),
  subjectKey: SUBJECT_KEY
};

/** The DataPoint envelope every mapper now receives alongside its union member. */
export function meta(overrides: Partial<DataPointMeta> = {}): DataPointMeta {
  return { ...CONTEXT, ...overrides };
}

export const ABSENT = { coding: [{ system: DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }] };
