import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraResilienceItem, OuraResilienceResponseList } from '../../api/schemas/resilience';
import { mapOuraResilienceToFHIR } from '../../fhir/mappers/resilience';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraResilienceToFHIR', () => {
  const baseResilience: OuraResilienceItem = {
    id: 'resilience-123',
    day: '2023-08-15',
    level: 'solid',
    contributors: {
      sleep_recovery: 10,
      daytime_recovery: 20,
      stress: 30
    }
  };

  it('returns an empty array when no resilience data is provided', () => {
    expect(mapOuraResilienceToFHIR(null as unknown as OuraResilienceResponseList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraResilienceResponseList = { data: [], next_token: null };

    expect(mapOuraResilienceToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraResilienceResponseList = { data: [baseResilience], next_token: null };

    const [observation] = mapOuraResilienceToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      code: { coding: [{ system: SYSTEMS.OURA, code: 'resilience-level', display: 'Oura Resilience Level' }] },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'resilience-123' }],
      subject: { reference: TEST_SUBJECT_REFERENCE },
      effectiveDateTime: '2023-08-15'
    });
  });

  it('maps the resilience level to a coded value, not free text', () => {
    const input: OuraResilienceResponseList = { data: [baseResilience], next_token: null };

    const [observation] = mapOuraResilienceToFHIR(input, TEST_CONTEXT);

    // `level` is a five-term closed value set. As a valueString a receiver has
    // nothing to bind it to.
    expect(observation.valueString).toBeUndefined();
    expect(observation.valueCodeableConcept).toEqual({
      coding: [{ system: SYSTEMS.OURA, code: 'solid' }],
      text: 'solid'
    });
  });

  it('maps all contributors to observation components', () => {
    const input: OuraResilienceResponseList = { data: [baseResilience], next_token: null };

    const [observation] = mapOuraResilienceToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(3);
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'sleep-recovery', display: 'Sleep Recovery' }] },
      valueQuantity: { value: 10, unit: 'score', system: SYSTEMS.UCUM, code: '{score}' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'daytime-recovery', display: 'Daytime Recovery' }] },
      valueQuantity: { value: 20, unit: 'score', system: SYSTEMS.UCUM, code: '{score}' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'stress', display: 'Stress' }] },
      valueQuantity: { value: 30, unit: 'score', system: SYSTEMS.UCUM, code: '{score}' }
    });
  });

  it('omits contributor components when their values are undefined', () => {
    const input: OuraResilienceResponseList = {
      data: [{ ...baseResilience, contributors: { sleep_recovery: 10 } }],
      next_token: null
    };

    const [observation] = mapOuraResilienceToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(1);
    expect(observation.component?.[0].code?.coding?.[0].code).toBe('sleep-recovery');
    expect(observation.component?.[0].valueQuantity?.value).toBe(10);
  });

  it('sets component to undefined when no contributors are present', () => {
    const input: OuraResilienceResponseList = {
      data: [{ ...baseResilience, contributors: {} }],
      next_token: null
    };

    const [observation] = mapOuraResilienceToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
  });

  it('sets dataAbsentReason when the level is undefined', () => {
    const input: OuraResilienceResponseList = {
      data: [{ ...baseResilience, level: undefined }],
      next_token: null
    };

    const [observation] = mapOuraResilienceToFHIR(input, TEST_CONTEXT);

    expect(observation.valueCodeableConcept).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraResilienceResponseList = {
      data: [baseResilience, { ...baseResilience, id: 'resilience-456', day: '2023-08-16', level: 'adequate' }],
      next_token: null
    };

    const observations = mapOuraResilienceToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('resilience-123');
    expect(observations[0].effectiveDateTime).toBe('2023-08-15');
    expect(observations[1].identifier?.[0].value).toBe('resilience-456');
    expect(observations[1].effectiveDateTime).toBe('2023-08-16');
    expect(observations[1].valueCodeableConcept?.coding?.[0].code).toBe('adequate');
  });
});
