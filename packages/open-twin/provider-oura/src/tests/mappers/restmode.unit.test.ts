import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraRestMode, OuraRestModeList } from '../../api/schemas/restmode';
import { mapOuraRestModeToFHIR } from '../../fhir/mappers/restmode';
import { ouraExtensionUrl } from '../../fhir/mappers/shared';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

const START_DAY_URL = ouraExtensionUrl('rest-mode-start-day');
const END_DAY_URL = ouraExtensionUrl('rest-mode-end-day');
const EPISODE_URL = ouraExtensionUrl('rest-mode-episode');

describe('mapOuraRestModeToFHIR', () => {
  const restmode: OuraRestMode = {
    id: '123',
    end_day: '2026-07-20',
    end_time: '2026-07-20T23:59:59Z',
    start_day: '2026-07-01',
    start_time: '2026-07-01T00:00:00Z',
    episodes: [
      {
        tag: ['tag1', 'tag2'],
        timestamp: '2026-07-10T12:00:00Z'
      }
    ]
  };

  it('returns an empty array when no rest mode data is provided', () => {
    expect(mapOuraRestModeToFHIR(null as unknown as OuraRestModeList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraRestModeList = { data: [], next_token: null };

    expect(mapOuraRestModeToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a rest mode period to a FHIR Observation resource', () => {
    const [result] = mapOuraRestModeToFHIR({ data: [restmode] }, TEST_CONTEXT);

    expect(result).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      code: { coding: [{ system: SYSTEMS.OURA, code: 'rest-mode', display: 'Oura Rest Mode' }] },
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: '123' }],
      effectivePeriod: { start: restmode.start_time, end: restmode.end_time },
      // A period is not a measurement: it has no value by construction.
      dataAbsentReason: {
        coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'not-applicable', display: 'Not Applicable' }]
      }
    });
  });

  it('gives the start day, the end day and each episode distinct extension urls', () => {
    const [result] = mapOuraRestModeToFHIR({ data: [restmode] }, TEST_CONTEXT);

    // All of these previously shared one url, so a consumer reading the array
    // could not tell a start day from an end day from an episode timestamp.
    expect(result.extension).toEqual([
      { url: START_DAY_URL, valueString: '2026-07-01' },
      { url: END_DAY_URL, valueString: '2026-07-20' },
      { url: EPISODE_URL, valueString: '2026-07-10T12:00:00Z [tag1, tag2]' }
    ]);
    expect(new Set([START_DAY_URL, END_DAY_URL, EPISODE_URL]).size).toBe(3);
  });

  it('omits the start_day and end_day extensions when they are null', () => {
    const input: OuraRestModeList = {
      data: [{ ...restmode, start_day: null, end_day: null }]
    };

    const [result] = mapOuraRestModeToFHIR(input, TEST_CONTEXT);

    expect(result.extension).toEqual([{ url: EPISODE_URL, valueString: '2026-07-10T12:00:00Z [tag1, tag2]' }]);
  });

  it('omits the tag suffix when an episode has no tags', () => {
    const input: OuraRestModeList = {
      data: [
        {
          ...restmode,
          start_day: null,
          end_day: null,
          episodes: [{ timestamp: '2026-07-11T09:00:00Z' }, { tag: [], timestamp: '2026-07-11T10:00:00Z' }]
        }
      ]
    };

    const [result] = mapOuraRestModeToFHIR(input, TEST_CONTEXT);

    expect(result.extension).toEqual([
      { url: EPISODE_URL, valueString: '2026-07-11T09:00:00Z' },
      { url: EPISODE_URL, valueString: '2026-07-11T10:00:00Z' }
    ]);
  });

  it('maps every episode to its own extension', () => {
    const input: OuraRestModeList = {
      data: [
        {
          ...restmode,
          start_day: null,
          end_day: null,
          episodes: [
            { tag: ['a'], timestamp: '2026-07-12T08:00:00Z' },
            { tag: ['b', 'c'], timestamp: '2026-07-12T09:00:00Z' }
          ]
        }
      ]
    };

    const [result] = mapOuraRestModeToFHIR(input, TEST_CONTEXT);

    expect(result.extension).toEqual([
      { url: EPISODE_URL, valueString: '2026-07-12T08:00:00Z [a]' },
      { url: EPISODE_URL, valueString: '2026-07-12T09:00:00Z [b, c]' }
    ]);
  });

  it('omits the extension property when there are no days or episodes', () => {
    const input: OuraRestModeList = {
      data: [{ ...restmode, start_day: null, end_day: null, episodes: undefined }]
    };

    const [result] = mapOuraRestModeToFHIR(input, TEST_CONTEXT);

    expect(result.extension).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraRestModeList = {
      data: [restmode, { ...restmode, id: '456' }]
    };

    const results = mapOuraRestModeToFHIR(input, TEST_CONTEXT);

    expect(results).toHaveLength(2);
    expect(results[0].identifier?.[0].value).toBe('123');
    expect(results[1].identifier?.[0].value).toBe('456');
  });
});
