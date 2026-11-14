/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { CATEGORY, createObservation, PROFILES, patientUuid, quantity, SYSTEMS, UCUM } from '@open-twin/fhir-core';
import type { FhirResource, Patient } from 'fhir/r4';
import type { OuraPersonal } from '../../api/schemas/personal';
import { CONNECTOR, LOINC, type OuraMapperContext, ouraExtensionUrl, ouraIdentifier, ouraResourceId } from './shared';

const ADMINISTRATIVE_GENDER = ['male', 'female', 'other', 'unknown'] as const;
type AdministrativeGender = (typeof ADMINISTRATIVE_GENDER)[number];

function toAdministrativeGender(value: string): AdministrativeGender {
  const normalised = value.toLowerCase();
  return (ADMINISTRATIVE_GENDER as readonly string[]).includes(normalised)
    ? (normalised as AdministrativeGender)
    : 'unknown';
}

/**
 * Returns the resources flat, not wrapped in a Bundle.
 *
 * The previous signature returned a Bundle which `bundleBuilder` then pushed as a
 * single entry of the outer Bundle, so the Patient, weight and height were nested
 * one level down and a consumer iterating `entry[].resource` as Observations
 * skipped all three.
 */
export function mapOuraPersonalToFHIR(person: OuraPersonal, context: OuraMapperContext): FhirResource[] {
  if (!person) return [];

  const patient: Patient = {
    resourceType: 'Patient',
    // Without an id the three sibling Observations referenced a Patient that
    // resolved to nothing, inside the very bundle that carried it.
    id: patientUuid(CONNECTOR.connector, person.id),
    identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: person.id }]
  };

  if (person.biological_sex) {
    // Oura's `biological_sex` is a self-asserted profile setting used to calibrate
    // the ring's algorithms. `Patient.gender` is a required binding to
    // administrative-gender — self-asserted, exactly that shape and provenance.
    // Emitting it as an Observation under LOINC 99501-9 asserted a clinician-
    // determined "sex parameter for clinical use", which it is not, and did so as
    // a valueString under an answer-list-bound concept, which no receiver can decode.
    patient.gender = toAdministrativeGender(person.biological_sex);
  }

  if (person.age !== null && person.age !== undefined) {
    // Oura supplies an age and never a date of birth. `currentYear - age - 1` was
    // a fabricated year-only birthDate, right for roughly half the population and
    // silently wrong for the other half — and downstream age-based reference
    // ranges cannot tell which. The age travels as what it is.
    patient.extension = [{ url: ouraExtensionUrl('personal-age'), valueInteger: person.age }];
  }

  const resources: FhirResource[] = [patient];

  const weight = quantity(person.weight, UCUM.KILOGRAM);
  if (weight) {
    resources.push(
      createObservation({
        id: ouraResourceId(context, person.id, 'body-weight'),
        // One identifier per Observation. All three previously shared a single
        // mutable array, which collapses to one resource under conditional create.
        identifier: ouraIdentifier(`${person.id}-weight`),
        code: LOINC.BODY_WEIGHT,
        category: CATEGORY.VITAL_SIGNS,
        subject: context.subject,
        // The R4 body-weight profile constrains effective[x] to 1..1.
        effectiveDateTime: context.retrievedAt,
        note: 'Oura reports this as a profile setting and supplies no measurement time. effectiveDateTime is when the profile was retrieved, not when the measurement was taken.',
        valueQuantity: weight,
        profiles: [PROFILES.BODY_WEIGHT]
      })
    );
  }

  // Oura reports height in metres. The R4 body-height profile binds
  // valueQuantity.code to ucum-bodylength, which contains exactly `cm` and
  // `[in_i]` — `m` is invalid under the profile even though LOINC lists it as an
  // example unit, so the value is converted.
  const heightCm = quantity(
    person.height === null || person.height === undefined ? undefined : Math.round(person.height * 1000) / 10,
    UCUM.CENTIMETRE
  );
  if (heightCm) {
    resources.push(
      createObservation({
        id: ouraResourceId(context, person.id, 'body-height'),
        identifier: ouraIdentifier(`${person.id}-height`),
        code: LOINC.BODY_HEIGHT,
        category: CATEGORY.VITAL_SIGNS,
        subject: context.subject,
        // The R4 body-height profile constrains effective[x] to 1..1.
        effectiveDateTime: context.retrievedAt,
        note: 'Oura reports this as a profile setting and supplies no measurement time. effectiveDateTime is when the profile was retrieved, not when the measurement was taken.',
        valueQuantity: heightCm,
        profiles: [PROFILES.BODY_HEIGHT]
      })
    );
  }

  // `person.email` is deliberately not emitted. It was previously pushed into
  // `Observation.identifier` under the system 'email', which is not an absolute
  // URI and therefore not a valid Identifier.system, and it put a direct
  // identifier into every clinical resource the connector produced.

  return resources;
}
