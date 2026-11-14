import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraSpo2, OuraSpo2List } from '../../api/schemas/spo2';
import { mapOuraSpo2ToFHIR } from '../../fhir/mappers/spo2';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraSpo2ToFHIR', () => {
  const baseSpo2: OuraSpo2 = {
    id: 'spo2-1',
    day: '2026-06-20',
    spo2_percentage: { average: 97.5 },
    breathing_disturbance_index: 4
  };

  it('returns an empty array when no SpO2 data is provided', () => {
    expect(mapOuraSpo2ToFHIR(null as unknown as OuraSpo2List, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraSpo2List = { data: [], next_token: null };

    expect(mapOuraSpo2ToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraSpo2List = { data: [baseSpo2], next_token: null };

    const [observation] = mapOuraSpo2ToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }],
      code: { coding: [{ system: SYSTEMS.OURA, code: 'spo2-daily-summary', display: 'Oura Daily SpO2 Summary' }] },
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'spo2-1' }],
      effectiveDateTime: '2026-06-20'
    });
  });

  it('says explicitly that the daily summary itself carries no value', () => {
    const input: OuraSpo2List = { data: [baseSpo2], next_token: null };

    const [observation] = mapOuraSpo2ToFHIR(input, TEST_CONTEXT);

    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'not-applicable', display: 'Not Applicable' }]
    });
  });

  it('maps the average SpO2 percentage and breathing disturbance index to components', () => {
    const input: OuraSpo2List = { data: [baseSpo2], next_token: null };

    const [observation] = mapOuraSpo2ToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(2);
    expect(observation.component).toContainEqual({
      code: {
        coding: [
          { system: SYSTEMS.LOINC, code: '59408-5' },
          { system: SYSTEMS.OURA, code: 'spo2-daily-average', display: 'Daily Average Oxygen Saturation' }
        ]
      },
      valueQuantity: { value: 97.5, unit: '%', system: SYSTEMS.UCUM, code: '%' }
    });
    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'breathing-disturbance-index', display: 'Breathing Disturbance Index' }]
      },
      valueQuantity: { value: 4, unit: 'per hour', system: SYSTEMS.UCUM, code: '/h' }
    });
  });

  it('omits the SpO2 component when spo2_percentage is null', () => {
    const input: OuraSpo2List = {
      data: [{ ...baseSpo2, spo2_percentage: null }],
      next_token: null
    };

    const [observation] = mapOuraSpo2ToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(1);
    expect(observation.component?.[0].code?.coding?.[0].code).toBe('breathing-disturbance-index');
  });

  it('omits the breathing disturbance component when its value is null', () => {
    const input: OuraSpo2List = {
      data: [{ ...baseSpo2, breathing_disturbance_index: null }],
      next_token: null
    };

    const [observation] = mapOuraSpo2ToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(1);
    expect(observation.component?.[0].code?.coding?.[0].code).toBe('59408-5');
  });

  it('sets component to undefined when no measurements are present', () => {
    const input: OuraSpo2List = {
      data: [{ ...baseSpo2, spo2_percentage: null, breathing_disturbance_index: null }],
      next_token: null
    };

    const [observation] = mapOuraSpo2ToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraSpo2List = {
      data: [baseSpo2, { ...baseSpo2, id: 'spo2-2', day: '2026-06-21' }],
      next_token: null
    };

    const observations = mapOuraSpo2ToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('spo2-1');
    expect(observations[0].effectiveDateTime).toBe('2026-06-20');
    expect(observations[1].identifier?.[0].value).toBe('spo2-2');
    expect(observations[1].effectiveDateTime).toBe('2026-06-21');
  });
});
