import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraSleep, OuraSleepList } from '../../api/schemas/sleep';
import { ouraExtensionUrl } from '../../fhir/mappers/shared';
import { mapOuraSleepToFHIR } from '../../fhir/mappers/sleep';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

const minutes = (value: number) => ({ value, unit: 'minute', system: SYSTEMS.UCUM, code: 'min' });

describe('mapOuraSleepToFHIR', () => {
  const baseSleep: OuraSleep = {
    id: 'sleep-1',
    bedtime_start: '2026-06-20T23:00:00+00:00',
    bedtime_end: '2026-06-21T07:00:00+00:00',
    day: '2026-06-21',
    score: 88,
    type: 'long_sleep',
    rem_sleep_duration: 5400,
    deep_sleep_duration: 3600,
    light_sleep_duration: 18000,
    efficiency: 95,
    latency: 600,
    lowest_heart_rate: 48,
    average_heart_rate: 55.5,
    time_in_bed: 28800,
    total_sleep_duration: 27000,
    awake_time: 1200,
    sleep_algorithm_version: 'v2',
    sleep_analysis_reason: 'normal',
    ring_id: 'ring-9',
    sleep_phase_30_sec: '111222333',
    temperature_deviation: 0.2
  };

  it('returns an empty array when no sleep data is provided', () => {
    expect(mapOuraSleepToFHIR(null as unknown as OuraSleepList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraSleepList = { data: [], next_token: null };

    expect(mapOuraSleepToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'sleep-score', display: 'Oura Sleep Score' }],
        text: 'long_sleep'
      },
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'sleep-1' }],
      effectivePeriod: {
        start: '2026-06-20T23:00:00+00:00',
        end: '2026-06-21T07:00:00+00:00'
      }
    });
  });

  it('maps the sleep score to a UCUM-coded score Quantity', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    // Quantity.system must be the code system that defines the *unit*. It used to
    // be an Oura documentation URL, with 'sleep_score' as the unit code.
    expect(observation.valueQuantity).toEqual({
      value: 88,
      unit: 'score',
      system: SYSTEMS.UCUM,
      code: '{score}'
    });
  });

  it('converts sleep durations from seconds to the minutes LOINC binds them to', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    // Oura reports seconds. These were emitted as a bare `{ value }` with no unit
    // at all, so 5400 seconds of REM read as 5400 of whatever the receiver assumed.
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93832-4', display: 'Sleep duration' }] },
      valueQuantity: minutes(450)
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93829-0', display: 'REM sleep duration' }] },
      valueQuantity: minutes(90)
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93831-6', display: 'Deep sleep duration' }] },
      valueQuantity: minutes(60)
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93830-8', display: 'Light sleep duration' }] },
      valueQuantity: minutes(300)
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '103212-7', display: 'Duration of falling asleep' }] },
      valueQuantity: minutes(10)
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '103213-5', display: 'Duration in bed' }] },
      valueQuantity: minutes(480)
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'awake-time', display: 'Time Awake During Sleep Period' }] },
      valueQuantity: minutes(20)
    });
  });

  it('maps sleep efficiency to an Oura code with a percent unit', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    // SNOMED 248263006 means "Duration of sleep", so 95% efficiency was published
    // as 95 units of sleep duration with no unit attached.
    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'sleep-efficiency-percentage', display: 'Sleep Efficiency' }]
      },
      valueQuantity: { value: 95, unit: '%', system: SYSTEMS.UCUM, code: '%' }
    });
    expect(JSON.stringify(observation)).not.toContain('248263006');
  });

  it('maps the lowest heart rate to LOINC 103222-6, not to the resting heart rate code', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    // 40443-4 is "Heart rate --resting": measured awake and at rest, a different
    // statistic from a different physiological state.
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '103222-6', display: 'Heart rate.minimum' }] },
      valueQuantity: { value: 48, unit: 'per minute', system: SYSTEMS.UCUM, code: '/min' }
    });
    expect(JSON.stringify(observation)).not.toContain('40443-4');
  });

  it('says on the code itself that the average heart rate is a period mean', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: {
        coding: [
          { system: SYSTEMS.LOINC, code: '8867-4', display: 'Heart rate' },
          { system: SYSTEMS.OURA, code: 'sleep-average-heart-rate', display: 'Average Heart Rate During Sleep' }
        ]
      },
      valueQuantity: { value: 55.5, unit: 'per minute', system: SYSTEMS.UCUM, code: '/min' }
    });
  });

  it('emits the temperature deviation in Kelvin under an Oura code', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'temperature-deviation', display: 'Temperature Deviation' }] },
      valueQuantity: { value: 0.2, unit: 'degree Kelvin', system: SYSTEMS.UCUM, code: 'K' }
    });
  });

  it('maps optional metadata to method and note', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observation.method).toEqual({ text: 'v2' });
    expect(observation.note).toEqual([{ text: 'normal' }]);
  });

  it('carries the ring id as an extension instead of a Device reference that resolves to nothing', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observation.device).toBeUndefined();
    expect(observation.extension).toContainEqual({
      url: ouraExtensionUrl('ring-id'),
      valueString: 'ring-9'
    });
  });

  it('maps phase data to distinct extension urls', () => {
    const input: OuraSleepList = { data: [baseSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observation.extension).toContainEqual({
      url: ouraExtensionUrl('sleep-day'),
      valueString: '2026-06-21'
    });
    expect(observation.extension).toContainEqual({
      url: ouraExtensionUrl('sleep-phase-30-sec'),
      valueString: '111222333'
    });
  });

  it('sets dataAbsentReason when the score is absent', () => {
    const minimalSleep: OuraSleep = {
      id: 'sleep-min',
      bedtime_start: '2026-06-20T23:00:00+00:00',
      bedtime_end: '2026-06-21T07:00:00+00:00',
      day: '2026-06-21'
    };
    const input: OuraSleepList = { data: [minimalSleep], next_token: null };

    const [observation] = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
    expect(observation.method).toBeUndefined();
    expect(observation.note).toBeUndefined();
    expect(observation.device).toBeUndefined();
    expect(observation.component).toBeUndefined();
    expect(observation.extension).toEqual([{ url: ouraExtensionUrl('sleep-day'), valueString: '2026-06-21' }]);
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraSleepList = {
      data: [baseSleep, { ...baseSleep, id: 'sleep-2', day: '2026-06-22' }],
      next_token: null
    };

    const observations = mapOuraSleepToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('sleep-1');
    expect(observations[1].identifier?.[0].value).toBe('sleep-2');
  });
});
