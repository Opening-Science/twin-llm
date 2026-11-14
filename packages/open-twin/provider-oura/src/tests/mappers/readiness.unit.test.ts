import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraReadinessItem, OuraReadinessResponseList } from '../../api/schemas/readiness';
import { mapOuraReadinessToFHIR } from '../../fhir/mappers/readiness';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraReadinessToFHIR', () => {
  const baseEntry: OuraReadinessItem = {
    id: 'readiness-1',
    day: '2026-06-20',
    timestamp: '2026-06-20T08:00:00+00:00',
    score: 82,
    contributors: {
      activity_balance: 90,
      hrv_balance: 85,
      previous_day_activity: 70,
      previous_night: 95,
      recovery_index: 88,
      resting_heart_rate: 92,
      sleep_balance: 80,
      sleep_regularity: 75
    },
    temperature_deviation: 0.3,
    temperature_trend_deviation: 0.1
  };

  it('returns an empty array when no readiness data is provided', () => {
    expect(mapOuraReadinessToFHIR(null as unknown as OuraReadinessResponseList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraReadinessResponseList = { data: [], next_token: null };

    expect(mapOuraReadinessToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraReadinessResponseList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      code: { coding: [{ system: SYSTEMS.OURA, code: 'readiness-score', display: 'Oura Readiness Score' }] },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'readiness-1' }],
      subject: { reference: TEST_SUBJECT_REFERENCE },
      effectiveDateTime: '2026-06-20T08:00:00+00:00'
    });
  });

  it('preserves a non-UTC offset rather than normalising the day away', () => {
    const input: OuraReadinessResponseList = {
      data: [{ ...baseEntry, timestamp: '2026-06-20T00:00:00+03:00' }],
      next_token: null
    };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observation.effectiveDateTime).toBe('2026-06-20T00:00:00+03:00');
  });

  it('maps the readiness score to valueQuantity', () => {
    const input: OuraReadinessResponseList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toEqual({
      value: 82,
      unit: 'score',
      system: SYSTEMS.UCUM,
      code: '{score}'
    });
    expect(observation.dataAbsentReason).toBeUndefined();
  });

  it('maps all contributor scores to components', () => {
    const input: OuraReadinessResponseList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(10);
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'activity-balance', display: 'Activity Balance' }] },
      valueQuantity: { value: 90, unit: 'score', system: SYSTEMS.UCUM, code: '{score}' }
    });
  });

  it('emits temperature deviations in Kelvin, the UCUM unit for a difference', () => {
    const input: OuraReadinessResponseList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    // UCUM `Cel` is a point on an interval scale and cannot take part in algebraic
    // operations; a difference is `K`, and 1 K equals 1 degC as an interval, so no
    // value conversion is needed.
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'temperature-deviation', display: 'Temperature Deviation' }] },
      valueQuantity: { value: 0.3, unit: 'degree Kelvin', system: SYSTEMS.UCUM, code: 'K' }
    });
    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'temperature-trend-deviation', display: 'Temperature Trend Deviation' }]
      },
      valueQuantity: { value: 0.1, unit: 'degree Kelvin', system: SYSTEMS.UCUM, code: 'K' }
    });
  });

  it('sets dataAbsentReason and omits valueQuantity when score is null', () => {
    const input: OuraReadinessResponseList = {
      data: [{ ...baseEntry, score: null }],
      next_token: null
    };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
  });

  it('omits contributor components when their values are null or undefined', () => {
    const input: OuraReadinessResponseList = {
      data: [
        {
          ...baseEntry,
          contributors: { activity_balance: 90, hrv_balance: null },
          temperature_deviation: null,
          temperature_trend_deviation: undefined
        }
      ],
      next_token: null
    };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(1);
    expect(observation.component?.[0].code?.coding?.[0].code).toBe('activity-balance');
  });

  it('sets component to undefined when no contributors or temperatures are present', () => {
    const input: OuraReadinessResponseList = {
      data: [
        {
          ...baseEntry,
          contributors: {},
          temperature_deviation: null,
          temperature_trend_deviation: null
        }
      ],
      next_token: null
    };

    const [observation] = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraReadinessResponseList = {
      data: [
        { ...baseEntry, id: 'readiness-1', timestamp: '2026-06-20T08:00:00+00:00' },
        { ...baseEntry, id: 'readiness-2', timestamp: '2026-06-21T08:00:00+00:00' }
      ],
      next_token: null
    };

    const observations = mapOuraReadinessToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('readiness-1');
    expect(observations[0].effectiveDateTime).toBe('2026-06-20T08:00:00+00:00');
    expect(observations[1].identifier?.[0].value).toBe('readiness-2');
    expect(observations[1].effectiveDateTime).toBe('2026-06-21T08:00:00+00:00');
  });
});
