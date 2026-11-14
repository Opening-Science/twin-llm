import { ConnectorError } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import { parseOuraResponse } from '../objectUtils';

describe('parseOuraResponse', () => {
  it('parses a personal_info response', () => {
    const body = { id: 'user-123', age: 30, weight: 70, height: 1.8, biological_sex: 'male' };

    const result = parseOuraResponse('personal_info', body);

    expect(result.type).toBe('personal_info');
    expect(result.data).toMatchObject({ id: 'user-123', age: 30 });
  });

  it('parses a list response against the schema for the type that was requested', () => {
    const body = {
      data: [
        {
          id: 'sleep-1',
          bedtime_start: '2026-06-20T23:00:00+00:00',
          bedtime_end: '2026-06-21T07:00:00+00:00',
          day: '2026-06-21',
          score: 90
        }
      ],
      next_token: null
    };

    const result = parseOuraResponse('sleep', body);

    expect(result.type).toBe('sleep');
    expect(result.type === 'sleep' && result.data.data[0].score).toBe(90);
  });

  it('parses a workout response, which structural sniffing could never reach', () => {
    // The old discriminator keyed on `workout_type`, a field no Oura response has,
    // so every workout was classified `unknown` and rejected the whole fan-out.
    const body = {
      data: [
        {
          id: 'w1',
          activity: 'running',
          source: 'confirmed',
          intensity: 'moderate',
          start_datetime: '2026-06-20T08:00:00+00:00',
          end_datetime: '2026-06-20T08:30:00+00:00',
          day: '2026-06-20',
          calories: 500,
          distance: 5,
          label: null
        }
      ],
      next_token: null
    };

    const result = parseOuraResponse('workout', body);

    expect(result.type).toBe('workout');
    expect(result.type === 'workout' && result.data.data[0].activity).toBe('running');
  });

  it.each([
    ['daily_activity', { id: 'a1', day: '2026-06-20', timestamp: '2026-06-20T00:00:00+00:00', contributors: {} }],
    ['daily_readiness', { id: 'r1', day: '2026-06-20', timestamp: '2026-06-20T00:00:00+00:00', contributors: {} }],
    ['daily_resilience', { id: 'x1', day: '2026-06-20', contributors: {} }],
    ['daily_stress', { id: 's1', day: '2026-06-20' }],
    ['ring_configuration', { id: 'c1' }],
    ['vO2_max', { id: 'v1', day: '2026-06-20', timestamp: '2026-06-20T00:00:00+00:00' }],
    ['rest_mode_period', { id: 'p1', start_day: null, end_day: null, start_time: 'x', end_time: 'y' }]
  ] as const)('parses %s even when every optional field is omitted', (type, record) => {
    // Seven of the thirteen old discriminators keyed on optional fields, so a valid
    // response that omitted one was classified `unknown` and discarded.
    const result = parseOuraResponse(type, { data: [record], next_token: null });

    expect(result.type).toBe(type);
  });

  it('throws a typed validation error naming the failing paths', () => {
    let thrown: unknown;
    try {
      parseOuraResponse('sleep', { data: [{ unexpected: 'structure' }], next_token: null });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConnectorError);
    expect((thrown as ConnectorError).code).toBe('validation');
    expect((thrown as ConnectorError).message).toContain('did not match its schema');
  });

  it('never attaches the raw payload to the thrown error', () => {
    let thrown: Error | undefined;
    try {
      parseOuraResponse('heartrate', {
        data: [{ timestamp: '2026-06-20T08:00:00+00:00', bpm: 'not-a-number', source: 'awake' }],
        next_token: null
      });
    } catch (error) {
      thrown = error as Error;
    }

    // `Error.cause` is serialised by most error reporters and by Node's own
    // uncaught-exception printer. It used to carry the whole biometric record.
    expect(thrown?.cause).toBeUndefined();
    expect(thrown?.message).not.toContain('not-a-number');
    // Field *names* are structural and safe; they are what makes the error useful.
    expect(thrown?.message).toContain('bpm');
  });
});
