import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraDailyActivityItem, OuraDailyActivityResponseList } from '../../api/schemas/daily';
import { mapOuraDailyActivityToFHIR } from '../../fhir/mappers/daily';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraDailyActivityToFHIR', () => {
  const baseActivity: OuraDailyActivityItem = {
    id: 'activity-1',
    day: '2026-06-20',
    timestamp: '2026-06-20T04:00:00+00:00',
    score: 85,
    active_calories: 400,
    total_calories: 2500,
    target_calories: 350,
    steps: 9000,
    high_activity_met_minutes: 300,
    sedentary_time: 36000,
    contributors: {
      meet_daily_targets: 90,
      move_every_hour: 80
    }
  };

  it('maps an activity entry to a FHIR Observation resource', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'activity-1' }],
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'activity-score', display: 'Oura Activity Score' }]
      }
    });
  });

  it('sets the root valueQuantity from the activity score', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.valueQuantity).toEqual({
      value: 85,
      unit: 'score',
      system: SYSTEMS.UCUM,
      code: '{score}'
    });
  });

  it('sets dataAbsentReason when score is missing', () => {
    const { score: _score, ...withoutScore } = baseActivity;
    const input: OuraDailyActivityResponseList = { data: [withoutScore], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    // `score ?? 0` published the worst possible value on an 0-100 scale, which no
    // receiver could tell apart from a genuine zero.
    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }]
    });
  });

  it('preserves the local UTC offset on effectiveDateTime', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.effectiveDateTime).toBe('2026-06-20T04:00:00+00:00');
  });

  it('does not shift a non-UTC daily summary into the previous day', () => {
    // Oura's daily timestamp is the wearer's local midnight. Normalising it to UTC
    // moved every summary east of UTC back one calendar day.
    const input: OuraDailyActivityResponseList = {
      data: [{ ...baseActivity, day: '2026-06-20', timestamp: '2026-06-20T00:00:00+03:00' }],
      next_token: null
    };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.effectiveDateTime).toBe('2026-06-20T00:00:00+03:00');
    expect(observation.effectiveDateTime).not.toContain('2026-06-19');
  });

  it('attributes the Observation to the subject supplied by the caller', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.subject?.reference).toBe(TEST_SUBJECT_REFERENCE);
  });

  it('maps steps under 41950-7 with the per-day denominator its 24-hour time axis requires', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: SYSTEMS.LOINC, code: '41950-7', display: 'Number of steps in 24 hour Measured' }]
      },
      valueQuantity: { value: 9000, unit: 'steps per day', system: SYSTEMS.UCUM, code: '{steps}/d' }
    });
  });

  it("maps the day's total calories under 41979-6 with kcal/(24.h)", () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: SYSTEMS.LOINC, code: '41979-6', display: 'Calories burned in 24 hour Calculated' }]
      },
      valueQuantity: { value: 2500, unit: 'kcal/24h', system: SYSTEMS.UCUM, code: 'kcal/(24.h)' }
    });
  });

  it('emits MET-minutes as an annotation, never as minutes', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    // A conformant parser discards annotations, so code 'min' made a receiver read
    // 300 MET-minutes as 300 minutes of activity.
    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'high-activity-met-minutes', display: 'High Activity MET Minutes' }]
      },
      valueQuantity: { value: 300, unit: 'MET-min', system: SYSTEMS.UCUM, code: '{MET-min}' }
    });
  });

  it('converts activity durations from seconds to minutes', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'sedentary-time', display: 'Sedentary Time' }] },
      valueQuantity: { value: 600, unit: 'minute', system: SYSTEMS.UCUM, code: 'min' }
    });
  });

  it('maps contributors into scored components', () => {
    const input: OuraDailyActivityResponseList = { data: [baseActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'meet-daily-targets', display: 'Meet Daily Targets' }] },
      valueQuantity: { value: 90, unit: 'score', system: SYSTEMS.UCUM, code: '{score}' }
    });
  });

  it('omits components for metrics that are not present', () => {
    const minimalActivity = {
      id: 'activity-min',
      day: '2026-06-21',
      timestamp: '2026-06-21T04:00:00+00:00',
      contributors: {}
    };
    const input: OuraDailyActivityResponseList = { data: [minimalActivity], next_token: null };

    const [observation] = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraDailyActivityResponseList = {
      data: [
        { ...baseActivity, id: 'activity-1' },
        { ...baseActivity, id: 'activity-2' }
      ],
      next_token: null
    };

    const observations = mapOuraDailyActivityToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('activity-1');
    expect(observations[1].identifier?.[0].value).toBe('activity-2');
    expect(observations[0].id).not.toBe(observations[1].id);
  });

  it('returns an empty array when the response contains no data', () => {
    const input: OuraDailyActivityResponseList = { data: [], next_token: null };

    expect(mapOuraDailyActivityToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });
});
