import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { Session, SessionList } from '../../api/schemas/session';
import { mapOuraSessionToFHIR } from '../../fhir/mappers/session';
import { ouraExtensionUrl } from '../../fhir/mappers/shared';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

const TYPE_URL = ouraExtensionUrl('session-type');
const DAY_URL = ouraExtensionUrl('session-day');

describe('mapOuraSessionToFHIR', () => {
  const baseSession: Session = {
    id: 'session-1',
    day: '2026-06-20',
    start_datetime: '2026-06-20T08:00:00+00:00',
    end_datetime: '2026-06-20T08:15:00+00:00',
    type: 'meditation',
    mood: 'good',
    heart_rate: { interval: 5, items: [60, 62, 64], timestamp: '2026-06-20T08:00:00+00:00' },
    heart_rate_variability: { interval: 5, items: [40, 50], timestamp: '2026-06-20T08:00:00+00:00' },
    motion_count: { interval: 5, items: [1, 3], timestamp: '2026-06-20T08:00:00+00:00' }
  };

  it('returns an empty array when no session data is provided', () => {
    expect(mapOuraSessionToFHIR(null as unknown as SessionList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: SessionList = { data: [], next_token: null };

    expect(mapOuraSessionToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: SessionList = { data: [baseSession], next_token: null };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'session', display: 'Oura Session' }],
        text: 'meditation'
      },
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'session-1' }],
      effectivePeriod: {
        start: '2026-06-20T08:00:00+00:00',
        end: '2026-06-20T08:15:00+00:00'
      }
    });
  });

  it('says on the code itself that the heart rate component is a session mean', () => {
    const input: SessionList = { data: [baseSession], next_token: null };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    // Bare LOINC 8867-4 is an instantaneous beat. Publishing a 15-minute mean
    // under it, distinguished only by a display string, is not machine-readable.
    expect(observation.component).toContainEqual({
      code: {
        coding: [
          { system: SYSTEMS.LOINC, code: '8867-4', display: 'Heart rate' },
          { system: SYSTEMS.OURA, code: 'session-mean-heart-rate', display: 'Session Mean Heart Rate' }
        ]
      },
      valueQuantity: { value: 62, unit: 'per minute', system: SYSTEMS.UCUM, code: '/min' }
    });
  });

  it('averages the HRV and motion count samples into components', () => {
    const input: SessionList = { data: [baseSession], next_token: null };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: {
        coding: [
          {
            system: SYSTEMS.OURA,
            code: 'session-mean-heart-rate-variability',
            display: 'Session Mean Heart Rate Variability'
          }
        ]
      },
      valueQuantity: { value: 45, unit: 'millisecond', system: SYSTEMS.UCUM, code: 'ms' }
    });
    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'session-mean-motion-count', display: 'Session Mean Motion Count' }]
      },
      valueQuantity: { value: 2, unit: 'count', system: SYSTEMS.UCUM, code: '{count}' }
    });
  });

  it('maps mood to a coded component rather than a free-text extension', () => {
    const input: SessionList = { data: [baseSession], next_token: null };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'session-mood', display: 'Session Mood' }] },
      valueCodeableConcept: { coding: [{ system: SYSTEMS.OURA, code: 'good' }] }
    });
  });

  it('gives the type and day extensions distinct urls', () => {
    const input: SessionList = { data: [baseSession], next_token: null };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation.extension).toEqual([
      { url: TYPE_URL, valueString: 'meditation' },
      { url: DAY_URL, valueString: '2026-06-20' }
    ]);
    expect(TYPE_URL).not.toBe(DAY_URL);
  });

  it('omits the mood component when mood is null', () => {
    const input: SessionList = {
      data: [{ ...baseSession, mood: null }],
      next_token: null
    };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation.component?.some((component) => component.valueCodeableConcept !== undefined)).toBe(false);
  });

  it('omits sample components when their samples are null', () => {
    const input: SessionList = {
      data: [{ ...baseSession, mood: null, heart_rate: null, heart_rate_variability: null, motion_count: null }],
      next_token: null
    };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
  });

  it('ignores null values when averaging sample items', () => {
    const input: SessionList = {
      data: [
        {
          ...baseSession,
          mood: null,
          heart_rate: {
            interval: 5,
            items: [60, null as unknown as number, 70],
            timestamp: '2026-06-20T08:00:00+00:00'
          },
          heart_rate_variability: null,
          motion_count: null
        }
      ],
      next_token: null
    };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toHaveLength(1);
    expect(observation.component?.[0].valueQuantity?.value).toBe(65);
  });

  it('omits a sample component when its items array is empty', () => {
    const input: SessionList = {
      data: [
        {
          ...baseSession,
          mood: null,
          heart_rate: { interval: 5, items: [], timestamp: '2026-06-20T08:00:00+00:00' },
          heart_rate_variability: null,
          motion_count: null
        }
      ],
      next_token: null
    };

    const [observation] = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: SessionList = {
      data: [baseSession, { ...baseSession, id: 'session-2', day: '2026-06-21' }],
      next_token: null
    };

    const observations = mapOuraSessionToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('session-1');
    expect(observations[1].identifier?.[0].value).toBe('session-2');
  });
});
