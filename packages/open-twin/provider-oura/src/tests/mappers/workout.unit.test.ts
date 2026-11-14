import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import type { OuraWorkout, OuraWorkoutList } from '../../api/schemas/workout';
import { ouraExtensionUrl } from '../../fhir/mappers/shared';
import { mapOuraWorkoutToFHIR } from '../../fhir/mappers/workout';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraWorkoutToFHIR', () => {
  const baseWorkout: OuraWorkout = {
    id: 'workout-1',
    day: '2026-06-20',
    calories: 500,
    distance: 5,
    source: 'confirmed' as const,
    activity: 'running',
    end_datetime: '2026-06-20T08:30:00+00:00',
    start_datetime: '2026-06-20T08:00:00+00:00',
    intensity: 'moderate' as const,
    label: 'Morning Run'
  };

  it('returns an empty array when no workout data is provided', () => {
    expect(mapOuraWorkoutToFHIR(null as unknown as OuraWorkoutList, TEST_CONTEXT)).toEqual([]);
  });

  it('returns an empty array when the response contains an empty data array', () => {
    const input: OuraWorkoutList = { data: [], next_token: null };

    expect(mapOuraWorkoutToFHIR(input, TEST_CONTEXT)).toEqual([]);
  });

  it('maps a fully populated entry to a FHIR Observation resource', () => {
    const input: OuraWorkoutList = { data: [baseWorkout], next_token: null };

    const [observation] = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }],
      code: {
        coding: [{ system: SYSTEMS.OURA, code: 'workout', display: 'Oura Workout' }],
        text: 'running'
      },
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'workout-1' }],
      effectivePeriod: {
        start: '2026-06-20T08:00:00+00:00',
        end: '2026-06-20T08:30:00+00:00'
      }
    });
  });

  it("maps a single workout's calories to LOINC 41981-2, not to the 24-hour total", () => {
    const input: OuraWorkoutList = { data: [baseWorkout], next_token: null };

    const [observation] = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);

    // 41979-6 is "Calories burned in 24 hour", so a 30-minute run burning 500 kcal
    // was published as a whole day's energy expenditure. 41981-2 has TIME = Pt and
    // example unit kcal, which is one activity.
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '41981-2', display: 'Calories burned' }] },
      valueQuantity: { value: 500, unit: 'kilocalorie', system: SYSTEMS.UCUM, code: 'kcal' }
    });
    expect(JSON.stringify(observation)).not.toContain('41979-6');
  });

  it('maps the distance to a component in metres', () => {
    const input: OuraWorkoutList = { data: [baseWorkout], next_token: null };

    const [observation] = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: SYSTEMS.OURA, code: 'workout-distance', display: 'Workout Distance' }] },
      valueQuantity: { value: 5, unit: 'meter', system: SYSTEMS.UCUM, code: 'm' }
    });
  });

  it('gives source, intensity, day and label four distinct extension urls', () => {
    const input: OuraWorkoutList = { data: [baseWorkout], next_token: null };

    const [observation] = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);

    expect(observation.extension).toEqual([
      { url: ouraExtensionUrl('workout-source'), valueString: 'confirmed' },
      { url: ouraExtensionUrl('workout-intensity'), valueString: 'moderate' },
      { url: ouraExtensionUrl('workout-day'), valueString: '2026-06-20' },
      { url: ouraExtensionUrl('workout-label'), valueString: 'Morning Run' }
    ]);
    expect(new Set(observation.extension?.map((extension) => extension.url)).size).toBe(4);
  });

  it('omits the label extension when the label is null', () => {
    const input: OuraWorkoutList = { data: [{ ...baseWorkout, label: null }], next_token: null };

    const [observation] = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);

    expect(observation.extension).toHaveLength(3);
  });

  it('omits components whose measurements are null', () => {
    const input: OuraWorkoutList = {
      data: [{ ...baseWorkout, calories: null, distance: null }],
      next_token: null
    };

    const [observation] = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);

    expect(observation.component).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'not-applicable', display: 'Not Applicable' }]
    });
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraWorkoutList = {
      data: [baseWorkout, { ...baseWorkout, id: 'workout-2' }],
      next_token: null
    };

    const observations = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);

    expect(observations).toHaveLength(2);
    expect(observations[0].identifier?.[0].value).toBe('workout-1');
    expect(observations[1].identifier?.[0].value).toBe('workout-2');
  });

  it('omits the label extension when the label is absent, not just null', () => {
    // `label` is optional AND nullable. The guard was `!== null`, so an omitted
    // label produced `{ url }` with no value[x] — an extension carrying neither a
    // value nor children, which violates FHIR invariant ext-1. The existing test
    // covered `label: null` only, so the suite could not see the absent case.
    const { label: _label, ...withoutLabel } = baseWorkout;
    const input: OuraWorkoutList = { data: [withoutLabel as OuraWorkout], next_token: null };
    const [observation] = mapOuraWorkoutToFHIR(input, TEST_CONTEXT);
    // Assert against the serialised form. In memory the extension carries
    // `valueString: undefined`, so an in-memory key count still sees two keys;
    // JSON.stringify drops it, and the bare `{ "url": ... }` is what the receiver
    // and the HL7 validator actually see.
    const serialised = JSON.parse(JSON.stringify(observation)) as { extension?: object[] };
    const valueless = (serialised.extension ?? []).filter((extension) => Object.keys(extension).length === 1);
    expect(valueless).toEqual([]);
  });
});
