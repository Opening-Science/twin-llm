import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraVO2MaxItem, OuraVO2MaxResponseList } from '../../api/schemas/vo2max';
import { mapOuraVO2MaxToFHIR } from '../../fhir/mappers/vo2max';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraVO2MaxToFHIR', () => {
  const baseVO2Max: OuraVO2MaxItem = {
    id: 'vo2max-1',
    day: '2026-06-20',
    timestamp: '2026-06-20T08:00:00+00:00',
    vo2_max: 48.5
  };

  it('returns an empty array when no VO2 max data is provided', () => {
    expect(mapOuraVO2MaxToFHIR(null as unknown as OuraVO2MaxResponseList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraVO2MaxResponseList = { data: [], next_token: null };

    expect(mapOuraVO2MaxToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraVO2MaxResponseList = { data: [baseVO2Max], next_token: null };

    const [observation] = mapOuraVO2MaxToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'vo2max-1' }],
      effectiveDateTime: '2026-06-20T08:00:00+00:00'
    });
  });

  it('uses the weight-indexed VO2 code, not the absolute one', () => {
    const input: OuraVO2MaxResponseList = { data: [baseVO2Max], next_token: null };

    const [observation] = mapOuraVO2MaxToFHIR(input, TEST_CONTEXT);

    // 60842-2 is absolute oxygen consumption, property VRat, example unit mL/min.
    // The mapper sends mL/kg/min, which is 94122-9 (property VRatCnt) — and that
    // is what provider-google-health already emits for the same measurement.
    expect(observation.code?.coding?.[0]).toMatchObject({ system: SYSTEMS.LOINC, code: '94122-9' });
    expect(JSON.stringify(observation)).not.toContain('60842-2');
  });

  it('maps the VO2 max value to valueQuantity', () => {
    const input: OuraVO2MaxResponseList = { data: [baseVO2Max], next_token: null };

    const [observation] = mapOuraVO2MaxToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toEqual({
      value: 48.5,
      unit: 'milliliter per kilogram per minute',
      system: SYSTEMS.UCUM,
      code: 'mL/kg/min'
    });
  });

  it('sets dataAbsentReason when vo2_max is undefined', () => {
    const input: OuraVO2MaxResponseList = {
      data: [{ ...baseVO2Max, vo2_max: undefined }],
      next_token: null
    };

    const [observation] = mapOuraVO2MaxToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
  });

  it('maps a vo2_max value of zero to valueQuantity', () => {
    const input: OuraVO2MaxResponseList = {
      data: [{ ...baseVO2Max, vo2_max: 0 }],
      next_token: null
    };

    const [observation] = mapOuraVO2MaxToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity?.value).toBe(0);
    expect(observation.dataAbsentReason).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraVO2MaxResponseList = {
      data: [baseVO2Max, { ...baseVO2Max, id: 'vo2max-2', day: '2026-06-21', timestamp: '2026-06-21T08:00:00+00:00' }],
      next_token: null
    };

    const observations = mapOuraVO2MaxToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('vo2max-1');
    expect(observations[0].effectiveDateTime).toBe('2026-06-20T08:00:00+00:00');
    expect(observations[1].identifier?.[0].value).toBe('vo2max-2');
    expect(observations[1].effectiveDateTime).toBe('2026-06-21T08:00:00+00:00');
  });
});
