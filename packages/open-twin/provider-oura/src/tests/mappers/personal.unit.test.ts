import { PROFILES, patientUuid, SYSTEMS } from '@open-twin/fhir-core';
import type { Observation, Patient } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import type { OuraPersonal } from '../../api/schemas/personal';
import { mapOuraPersonalToFHIR } from '../../fhir/mappers/personal';
import { ouraExtensionUrl } from '../../fhir/mappers/shared';
import { TEST_CONTEXT, TEST_RETRIEVED_AT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraPersonalToFHIR', () => {
  const mockPersonalData: OuraPersonal = {
    id: 'oura-12345',
    age: 30,
    weight: 82.5,
    height: 1.85,
    biological_sex: 'Male',
    email: 'berk@example.com'
  };

  it('returns an empty array when no personal data is provided', () => {
    expect(mapOuraPersonalToFHIR(null as unknown as OuraPersonal, TEST_CONTEXT)).toEqual([]);
  });

  it('returns the Patient and its Observations flat, not wrapped in a nested Bundle', () => {
    const resources = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT);

    // The nested Bundle meant a consumer iterating entries as Observations skipped
    // the Patient, the weight and the height entirely.
    expect(resources.map((resource) => resource.resourceType)).toEqual(['Patient', 'Observation', 'Observation']);
  });

  it('gives the Patient an id that the sibling Observations actually resolve to', () => {
    const [patient] = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT) as [Patient];

    expect(patient.id).toBe(patientUuid('oura', 'oura-12345'));
    expect(patient.identifier?.[0]).toEqual({ system: SYSTEMS.OURA_IDENTIFIER, value: 'oura-12345' });
  });

  it('carries biological sex on Patient.gender rather than as a coded Observation', () => {
    const resources = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT);
    const [patient] = resources as [Patient];

    // Oura's field is a self-asserted profile setting, which is exactly what
    // administrative gender is. LOINC 99501-9 asserts a clinician-determined "sex
    // parameter for clinical use", and it was sent as an undecodable valueString.
    expect(patient.gender).toBe('male');
    expect(JSON.stringify(resources)).not.toContain('99501-9');
  });

  it('carries age as an extension instead of fabricating a birthDate', () => {
    const [patient] = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT) as [Patient];

    // Oura supplies an age and never a date of birth. `currentYear - age - 1` was
    // right for roughly half the population and silently wrong for the rest.
    expect(patient.birthDate).toBeUndefined();
    expect(patient.extension).toEqual([{ url: ouraExtensionUrl('personal-age'), valueInteger: 30 }]);
  });

  it('maps weight to LOINC 29463-7 in kilograms with a per-observation identifier', () => {
    const [, weightObservation] = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT) as [Patient, Observation];

    expect(weightObservation.code?.coding?.[0]).toMatchObject({ system: SYSTEMS.LOINC, code: '29463-7' });
    expect(weightObservation.valueQuantity).toEqual({
      value: 82.5,
      unit: 'kilogram',
      system: SYSTEMS.UCUM,
      code: 'kg'
    });
    expect(weightObservation.identifier).toEqual([{ system: SYSTEMS.OURA_IDENTIFIER, value: 'oura-12345-weight' }]);
    expect(weightObservation.subject?.reference).toBe(TEST_SUBJECT_REFERENCE);
    expect(weightObservation.meta?.profile).toContain(PROFILES.BODY_WEIGHT);
  });

  it('converts height from metres to the centimetres the body-height profile requires', () => {
    const [, , heightObservation] = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT) as [
      Patient,
      Observation,
      Observation
    ];

    // ucum-bodylength is a required binding to exactly {cm, [in_i]}; `m` fails it
    // even though LOINC lists it as an example unit.
    expect(heightObservation.valueQuantity).toEqual({
      value: 185,
      unit: 'centimeter',
      system: SYSTEMS.UCUM,
      code: 'cm'
    });
    expect(heightObservation.identifier).toEqual([{ system: SYSTEMS.OURA_IDENTIFIER, value: 'oura-12345-height' }]);
    expect(heightObservation.meta?.profile).toContain(PROFILES.BODY_HEIGHT);
  });

  it('never puts the email address into any emitted resource', () => {
    const resources = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT);

    // It used to be pushed into Observation.identifier under the system 'email',
    // which is not an absolute URI and therefore not a valid Identifier.system.
    expect(JSON.stringify(resources)).not.toContain('berk@example.com');
    expect(JSON.stringify(resources)).not.toContain('"email"');
  });

  it('generates only the Patient resource when optional metrics are missing', () => {
    const resources = mapOuraPersonalToFHIR({ id: 'oura-67890' }, TEST_CONTEXT);

    expect(resources).toHaveLength(1);
    const [patient] = resources as [Patient];
    expect(patient.resourceType).toBe('Patient');
    expect(patient.gender).toBeUndefined();
    expect(patient.birthDate).toBeUndefined();
    expect(patient.extension).toBeUndefined();
  });

  it("maps an unhandled biological sex value to 'unknown'", () => {
    const resources = mapOuraPersonalToFHIR({ id: 'oura-11111', biological_sex: 'NotSpecified' }, TEST_CONTEXT);

    const [patient] = resources as [Patient];
    expect(patient.gender).toBe('unknown');
    // The raw string used to travel through as an Observation.valueString, i.e.
    // arbitrary free text presented as a clinical value.
    expect(JSON.stringify(resources)).not.toContain('NotSpecified');
  });

  it('gives body weight and height an effective[x], which their profiles require', () => {
    // Found by the HL7 validator, not by review:
    //   Observation.effective[x]: minimum required = 1, but only found 0
    //   (from http://hl7.org/fhir/StructureDefinition/bodyweight|4.0.1)
    // Oura supplies no measurement time for these, so the retrieval time is used
    // and the Observation says so rather than implying a measurement moment.
    const resources = mapOuraPersonalToFHIR(mockPersonalData, TEST_CONTEXT);
    const vitals = resources.filter(
      (resource): resource is Extract<typeof resource, { resourceType: 'Observation' }> =>
        resource.resourceType === 'Observation' &&
        (resource.meta?.profile ?? []).some(
          (profile) => profile.endsWith('bodyweight') || profile.endsWith('bodyheight')
        )
    );

    expect(vitals).toHaveLength(2);
    for (const observation of vitals) {
      expect(observation.effectiveDateTime).toBe(TEST_RETRIEVED_AT);
      expect(observation.note?.[0]?.text).toContain('not when the measurement was taken');
    }
  });
});
