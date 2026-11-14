/**
 * WHAT: Cross-source reconciliation / measure keys / source selection for overlapping Observations.
 * NOT:  Must not fetch vendor data or invent scores for openXR HealthTwinData.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator (CI emit-bundles).
 */
import {
  buildBundle,
  createObservation,
  minimalPatient,
  quantity,
  SYSTEMS,
  subjectReference,
  UCUM,
  type UcumUnit
} from '@open-twin/fhir-core';
import type { Bundle, Observation, Patient } from 'fhir/r4';
import { aggregate } from '../aggregate';

/**
 * Two connectors describing one night and one day, reconciled, for the HL7 validator.
 *
 * The point of validating this one is the resource the other bundles do not have: a
 * derived Observation carrying `derivedFrom` into resources in the same bundle and a
 * `method` under an open-twin CodeSystem. Both are the kind of thing that validates in
 * the abstract and fails in a bundle — a `derivedFrom` reference has to resolve, and an
 * undeclared CodeSystem is exactly what the conformance stage exists to catch.
 *
 * It carries the two outcomes that matter, side by side:
 *
 *   - sleep duration is reconciled and a derived Observation is emitted;
 *   - energy expenditure is not, because no source is dependable for it, so the two
 *     readings stand and nothing is asserted over them.
 */

const SUBJECT_KEY = 'aggregate-exemplar';
// One subject for every connector. Each would otherwise mint its own from
// patientUuid(connector, key), and the aggregator refuses to reconcile across subjects.
const SUBJECT = subjectReference({ connector: 'open-twin', subjectKey: SUBJECT_KEY });
const TIMESTAMP = '2026-07-27T10:00:00Z';
const DAY = '2026-06-20';

const patient: Patient = minimalPatient({
  connector: 'open-twin',
  subjectKey: SUBJECT_KEY,
  identifierSystem: 'http://opentwin.ch/fhir/sid/open-twin'
});

function reading(id: string, code: string, value: number, unit: UcumUnit): Observation {
  return createObservation({
    id,
    code: { system: SYSTEMS.LOINC, code },
    subject: SUBJECT,
    effectiveDateTime: `${DAY}T07:00:00+02:00`,
    valueQuantity: quantity(value, unit)
  });
}

function sourceBundle(connector: string, resources: Observation[]): Bundle {
  return buildBundle({
    connector: { connector, version: '0.1.0' },
    resources,
    timestamp: TIMESTAMP,
    bundleKey: `${connector}|${SUBJECT_KEY}|${DAY}`
  });
}

export function aggregateBundle(): Bundle {
  const oura = sourceBundle('oura', [
    reading('11110000-0000-5000-8000-000000000001', '93832-4', 402, UCUM.MINUTE),
    reading('11110000-0000-5000-8000-000000000002', '41979-6', 2300, UCUM.KILOCALORIE)
  ]);
  const google = sourceBundle('google-health', [
    reading('22220000-0000-5000-8000-000000000001', '93832-4', 415, UCUM.MINUTE),
    reading('22220000-0000-5000-8000-000000000002', '41979-6', 2650, UCUM.KILOCALORIE)
  ]);

  const { bundle } = aggregate({
    sources: [{ bundle: oura }, { bundle: google }],
    subjectKey: SUBJECT_KEY,
    timestamp: TIMESTAMP
  });

  // The Patient the sources' subject reference points at. The connectors did not carry
  // one because the integrator supplied the subject, so the aggregate bundle is where
  // it has to appear for the reference to resolve inside it.
  return {
    ...bundle,
    entry: [{ fullUrl: `urn:uuid:${patient.id}`, resource: patient }, ...(bundle.entry ?? [])]
  };
}
