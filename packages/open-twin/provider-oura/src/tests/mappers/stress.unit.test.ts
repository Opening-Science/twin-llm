import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraStress, OuraStressList } from '../../api/schemas/stress';
import { mapOuraStressToFHIR } from '../../fhir/mappers/stress';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraStressToFHIR', () => {
  const baseStress: OuraStress = {
    id: 'stress-1',
    day: '2026-06-20',
    day_summary: 'normal',
    stress_high: 7200,
    recovery_high: 3600
  };

  it('returns an empty array when no stress data is provided', () => {
    expect(mapOuraStressToFHIR(null as unknown as OuraStressList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraStressList = { data: [], next_token: null };

    expect(mapOuraStressToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraStressList = { data: [baseStress], next_token: null };

    const [observation] = mapOuraStressToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      code: { coding: [{ system: SYSTEMS.OURA, code: 'daily-stress', display: 'Oura Daily Stress' }] },
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'stress-1' }],
      effectiveDateTime: '2026-06-20'
    });
  });

  it('maps the day summary to a coded value, not free text', () => {
    const input: OuraStressList = { data: [baseStress], next_token: null };

    const [observation] = mapOuraStressToFHIR(input, TEST_CONTEXT);

    // `day_summary` is a three-term closed value set; as a valueString a receiver
    // has nothing to bind it to.
    expect(observation.valueString).toBeUndefined();
    expect(observation.valueCodeableConcept).toEqual({
      coding: [{ system: SYSTEMS.OURA, code: 'normal' }],
      text: 'normal'
    });
  });

  it('converts the stress and recovery durations from seconds to minutes', () => {
    const input: OuraStressList = { data: [baseStress], next_token: null };

    const [observation] = mapOuraStressToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toEqual([
      {
        code: { coding: [{ system: SYSTEMS.OURA, code: 'stress-high', display: 'Stress High Duration' }] },
        valueQuantity: { value: 120, unit: 'minute', system: SYSTEMS.UCUM, code: 'min' }
      },
      {
        code: { coding: [{ system: SYSTEMS.OURA, code: 'recovery-high', display: 'Recovery High Duration' }] },
        valueQuantity: { value: 60, unit: 'minute', system: SYSTEMS.UCUM, code: 'min' }
      }
    ]);
  });

  it('sets dataAbsentReason when the day summary is null', () => {
    const input: OuraStressList = { data: [{ ...baseStress, day_summary: null }], next_token: null };

    const [observation] = mapOuraStressToFHIR(input, TEST_CONTEXT);

    expect(observation.valueCodeableConcept).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraStressList = {
      data: [baseStress, { ...baseStress, id: 'stress-2', day: '2026-06-21' }],
      next_token: null
    };

    const observations = mapOuraStressToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('stress-1');
    expect(observations[1].identifier?.[0].value).toBe('stress-2');
  });
});
