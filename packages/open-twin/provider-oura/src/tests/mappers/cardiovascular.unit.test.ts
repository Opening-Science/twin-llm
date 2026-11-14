import { deterministicId, SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraCardiovascularAge, OuraCardiovascularAgeList } from '../../api/schemas/cardiovascular';
import { mapOuraCardiovascularAgeToFHIR } from '../../fhir/mappers/cardiovascular';
import { SUBJECT_KEY, TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraCardiovascularAgeToFHIR', () => {
  const baseEntry: OuraCardiovascularAge = {
    id: 'cardio-1',
    day: '2026-06-20',
    vascular_age: 32,
    pulse_wave_velocity: 7.5
  };

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraCardiovascularAgeList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'exam', display: 'Exam' }] }],
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'cardio-1' }],
      subject: { reference: TEST_SUBJECT_REFERENCE },
      effectiveDateTime: '2026-06-20'
    });
  });

  it('codes vascular age under the Oura code system, not the cardio-ankle vascular index', () => {
    const input: OuraCardiovascularAgeList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    // LOINC 77195-6 is CAVI: a dimensionless ratio whose normal value is near 8,
    // so a vascular age of 32 published under it reads as a catastrophic CAVI.
    expect(observation.code).toEqual({
      coding: [{ system: SYSTEMS.OURA, code: 'vascular-age', display: 'Oura Vascular Age' }]
    });
    expect(JSON.stringify(observation)).not.toContain('77195-6');
  });

  it('gives each Observation a deterministic id, so a re-sync does not duplicate it', () => {
    const input: OuraCardiovascularAgeList = { data: [baseEntry], next_token: null };

    const [first] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);
    const [second] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    expect(first.id).toBe(
      deterministicId({
        connector: 'oura',
        subjectKey: SUBJECT_KEY,
        recordId: 'cardio-1',
        measure: 'cardiovascular-age'
      })
    );
    expect(second.id).toBe(first.id);
  });

  it('maps vascular_age to valueQuantity in years', () => {
    const input: OuraCardiovascularAgeList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toEqual({
      value: 32,
      unit: 'year',
      system: SYSTEMS.UCUM,
      code: 'a'
    });
  });

  it('maps pulse_wave_velocity to a component in m/s', () => {
    const input: OuraCardiovascularAgeList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toEqual([
      {
        code: { coding: [{ system: SYSTEMS.LOINC, code: '77196-4', display: 'Pulse wave velocity' }] },
        valueQuantity: {
          value: 7.5,
          unit: 'meter per second',
          system: SYSTEMS.UCUM,
          code: 'm/s'
        }
      }
    ]);
  });

  it('sets dataAbsentReason when vascular_age is null', () => {
    const input: OuraCardiovascularAgeList = {
      data: [{ ...baseEntry, vascular_age: null }],
      next_token: null
    };

    const [observation] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
  });

  it('omits component when pulse_wave_velocity is null', () => {
    const input: OuraCardiovascularAgeList = {
      data: [{ ...baseEntry, pulse_wave_velocity: null }],
      next_token: null
    };

    const [observation] = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraCardiovascularAgeList = {
      data: [
        { ...baseEntry, id: 'cardio-1', day: '2026-06-20' },
        { ...baseEntry, id: 'cardio-2', day: '2026-06-21' }
      ],
      next_token: null
    };

    const observations = mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('cardio-1');
    expect(observations[0].effectiveDateTime).toBe('2026-06-20');
    expect(observations[1].identifier?.[0].value).toBe('cardio-2');
    expect(observations[1].effectiveDateTime).toBe('2026-06-21');
  });

  it('returns an empty array when the response contains no data', () => {
    const input: OuraCardiovascularAgeList = { data: [], next_token: null };

    expect(mapOuraCardiovascularAgeToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });
});
