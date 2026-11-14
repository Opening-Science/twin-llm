import { PROFILES, SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraHeartRate, OuraHeartRateList } from '../../api/schemas/heartrate';
import { mapOuraHeartRateToFHIR } from '../../fhir/mappers/heartrate';
import { ouraExtensionUrl } from '../../fhir/mappers/shared';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

const SOURCE_URL = ouraExtensionUrl('heart-rate-source');
const TIMESTAMP_URL = ouraExtensionUrl('heart-rate-timestamp-unix');

describe('mapOuraHeartRateToFHIR', () => {
  const baseEntry: OuraHeartRate = {
    timestamp: '2026-06-20T04:00:00+00:00',
    timestamp_unix: 123412341234,
    bpm: 60,
    source: 'awake' as const
  };

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraHeartRateList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }],
      code: { coding: [{ system: SYSTEMS.LOINC, code: '8867-4', display: 'Heart rate' }] },
      effectiveDateTime: '2026-06-20T04:00:00+00:00',
      valueQuantity: {
        value: 60,
        unit: 'per minute',
        system: SYSTEMS.UCUM,
        code: '/min'
      }
    });
  });

  it('declares the R4 heart-rate profile, whose fixed unit code is /min', () => {
    const input: OuraHeartRateList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

    expect(observation.meta?.profile).toContain(PROFILES.HEART_RATE);
    expect(observation.valueQuantity?.code).toBe('/min');
  });

  it('attributes the Observation to the subject supplied by the caller', () => {
    const input: OuraHeartRateList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

    expect(observation.subject?.reference).toBe(TEST_SUBJECT_REFERENCE);
  });

  it('gives the source and the unix timestamp distinct extension urls', () => {
    const input: OuraHeartRateList = { data: [baseEntry], next_token: null };

    const [observation] = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

    // Both extensions used to share one url, so a consumer could read the two
    // strings and not know which was which.
    expect(observation.extension).toEqual([
      { url: SOURCE_URL, valueString: 'awake' },
      { url: TIMESTAMP_URL, valueString: '123412341234' }
    ]);
    expect(SOURCE_URL).not.toBe(TIMESTAMP_URL);
  });

  it('omits the unix timestamp extension when the field is absent', () => {
    const { timestamp_unix: _unix, ...withoutUnix } = baseEntry;
    const input: OuraHeartRateList = { data: [withoutUnix], next_token: null };

    const [observation] = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

    expect(observation.extension).toEqual([{ url: SOURCE_URL, valueString: 'awake' }]);
  });

  it.each(['awake', 'workout', 'rest', 'sleep', 'live', 'session'] as const)(
    'maps the "%s" source into the source extension',
    (source) => {
      const input: OuraHeartRateList = { data: [{ ...baseEntry, source }], next_token: null };

      const [observation] = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

      expect(observation.extension?.[0]).toEqual({ url: SOURCE_URL, valueString: source });
    }
  );

  it('sets dataAbsentReason rather than a 0 bpm reading when bpm is not a number', () => {
    // A 0 bpm vital sign reads as asystole. `bpm ?? 0` made that the fallback.
    const input = {
      data: [{ ...baseEntry, bpm: undefined as unknown as number }],
      next_token: null
    } as OuraHeartRateList;

    const [observation] = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraHeartRateList = {
      data: [
        { ...baseEntry, timestamp: '2026-06-20T04:00:00+00:00', bpm: 60 },
        { ...baseEntry, timestamp: '2026-06-20T04:05:00+00:00', bpm: 62 }
      ],
      next_token: null
    };

    const observations = mapOuraHeartRateToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].valueQuantity?.value).toBe(60);
    expect(observations[0].effectiveDateTime).toBe('2026-06-20T04:00:00+00:00');
    expect(observations[1].valueQuantity?.value).toBe(62);
    expect(observations[1].effectiveDateTime).toBe('2026-06-20T04:05:00+00:00');
  });

  it('returns an empty array when no data is provided', () => {
    const input: OuraHeartRateList = { data: [], next_token: null };

    expect(mapOuraHeartRateToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the data property is missing', () => {
    const input = { next_token: null } as unknown as OuraHeartRateList;

    expect(mapOuraHeartRateToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });
});
