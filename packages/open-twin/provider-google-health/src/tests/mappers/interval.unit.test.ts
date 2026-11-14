import type { health_v4 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import {
  mapActiveEnergyBurnedToFHIR,
  mapActiveMinutesToFHIR,
  mapActiveZoneMinutesToFHIR,
  mapActivityLevelToFHIR,
  mapAltitudeToFHIR,
  mapBasalEnergyBurnedToFHIR,
  mapDistanceToFHIR,
  mapFloorsToFHIR,
  mapSedentaryPeriodToFHIR,
  mapStepsToFHIR,
  mapSwimLengthsDataToFHIR,
  mapTimeInHeartRateZoneToFHIR
} from '../../fhir/mappers/interval';
import { ABSENT, CONTEXT, GOOGLE_HEALTH, LOINC, meta, OBSERVATION_CATEGORY, UCUM_SYSTEM } from '../support/context';

/**
 * This file used to import from `../../fhir/mappers/daily` and duplicate the daily
 * suite, so all eleven interval mappers were untested — which is why millimetres and
 * unit-less quantities survived review.
 */
const INTERVAL: health_v4.Schema$ObservationTimeInterval = {
  startTime: '2026-06-20T12:00:00Z',
  startUtcOffset: '7200s',
  endTime: '2026-06-20T12:30:00Z',
  endUtcOffset: '7200s'
};

const PERIOD = { start: '2026-06-20T14:00:00.000+02:00', end: '2026-06-20T14:30:00.000+02:00' };

const ACTIVITY_CATEGORY = [{ coding: [{ system: OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }];

describe('mapActiveEnergyBurnedToFHIR', () => {
  it('maps kcal under LOINC 41981-2 with the subject-local period', () => {
    const observation = mapActiveEnergyBurnedToFHIR({ interval: INTERVAL, kcal: 320 }, meta());

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      subject: CONTEXT.subject,
      category: ACTIVITY_CATEGORY,
      code: {
        coding: [
          { system: LOINC, code: '41981-2', display: 'Calories burned' },
          { system: GOOGLE_HEALTH, code: 'active-energy-burned', display: 'Active energy burned' }
        ]
      },
      effectivePeriod: PERIOD,
      valueQuantity: { value: 320, unit: 'kilocalorie', system: UCUM_SYSTEM, code: 'kcal' }
    });
  });

  it('records a dataAbsentReason when kcal is missing', () => {
    const observation = mapActiveEnergyBurnedToFHIR({ interval: INTERVAL }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapBasalEnergyBurnedToFHIR', () => {
  it('maps the basal metric that was previously declared and mapped nowhere', () => {
    const observation = mapBasalEnergyBurnedToFHIR({ interval: INTERVAL, kcal: 1450 }, meta());

    expect(observation.code.coding).toContainEqual({
      system: GOOGLE_HEALTH,
      code: 'basal-energy-burned',
      display: 'Basal energy burned'
    });
    expect(observation.valueQuantity).toEqual({ value: 1450, unit: 'kilocalorie', system: UCUM_SYSTEM, code: 'kcal' });
  });

  it('does not collide with the active-energy Observation for the same interval', () => {
    const active = mapActiveEnergyBurnedToFHIR({ interval: INTERVAL, kcal: 320 }, meta());
    const basal = mapBasalEnergyBurnedToFHIR({ interval: INTERVAL, kcal: 1450 }, meta());

    expect(active.id).not.toBe(basal.id);
  });
});

describe('mapActiveMinutesToFHIR', () => {
  const base: health_v4.Schema$ActiveMinutes = {
    interval: INTERVAL,
    activeMinutesByActivityLevel: [
      { activityLevel: 'MODERATE', activeMinutes: '18' },
      { activityLevel: 'VIGOROUS', activeMinutes: '7' }
    ]
  };

  it('puts the activity level in the component code so two levels never collide', () => {
    const observation = mapActiveMinutesToFHIR(base, meta());
    const codes = observation.component?.map((component) => component.code.coding?.[0]?.code);

    expect(codes).toEqual(['active-minutes-moderate', 'active-minutes-vigorous']);
    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: GOOGLE_HEALTH, code: 'active-minutes-vigorous', display: 'Active minutes (VIGOROUS)' }]
      },
      valueQuantity: { value: 7, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
  });

  it('produces no components when no levels are reported', () => {
    expect(mapActiveMinutesToFHIR({ interval: INTERVAL }, meta()).component).toBeUndefined();
  });
});

describe('mapActiveZoneMinutesToFHIR', () => {
  it('maps the int64 string into a numeric minutes quantity', () => {
    const observation = mapActiveZoneMinutesToFHIR(
      { interval: INTERVAL, activeZoneMinutes: '24', heartRateZone: 'CARDIO' },
      meta()
    );

    expect(observation.valueQuantity).toEqual({ value: 24, unit: 'minute', system: UCUM_SYSTEM, code: 'min' });
    expect(typeof observation.valueQuantity?.value).toBe('number');
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'heart-rate-zone', display: 'Heart rate zone' }] },
      valueString: 'CARDIO'
    });
  });

  it('records a dataAbsentReason when the minutes are missing', () => {
    expect(mapActiveZoneMinutesToFHIR({ interval: INTERVAL }, meta()).dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapActivityLevelToFHIR', () => {
  it('makes the level the value, not a component beside an empty one', () => {
    const observation = mapActivityLevelToFHIR({ interval: INTERVAL, activityLevelType: 'SEDENTARY' }, meta());

    expect(observation.valueCodeableConcept).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'SEDENTARY', display: 'SEDENTARY' }]
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'duration', display: 'Duration at this activity level' }] },
      valueQuantity: { value: 30, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
  });

  it('records a dataAbsentReason when the level is missing', () => {
    const observation = mapActivityLevelToFHIR({ interval: INTERVAL }, meta());

    expect(observation.valueCodeableConcept).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapAltitudeToFHIR', () => {
  it('converts the millimetres Google sends into metres', () => {
    const observation = mapAltitudeToFHIR({ interval: INTERVAL, gainMillimeters: '125000' }, meta());

    expect(observation.valueQuantity).toEqual({ value: 125, unit: 'meter', system: UCUM_SYSTEM, code: 'm' });
  });

  it('records a dataAbsentReason when the gain is missing', () => {
    expect(mapAltitudeToFHIR({ interval: INTERVAL }, meta()).dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapDistanceToFHIR', () => {
  it('converts the millimetres Google sends into metres', () => {
    // A 5 km run published as 5000000 mm is technically true and useless, and it does
    // not agree with provider-vitronic, which already emits metres.
    const observation = mapDistanceToFHIR({ interval: INTERVAL, millimeters: '44286' }, meta());

    expect(observation.valueQuantity).toEqual({ value: 44.286, unit: 'meter', system: UCUM_SYSTEM, code: 'm' });
    expect(typeof observation.valueQuantity?.value).toBe('number');
  });

  it('records a dataAbsentReason when the distance is missing', () => {
    expect(mapDistanceToFHIR({ interval: INTERVAL }, meta()).dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapFloorsToFHIR', () => {
  it('emits the count as a UCUM annotation rather than a bare unit string', () => {
    const observation = mapFloorsToFHIR({ interval: INTERVAL, count: '12' }, meta());

    expect(observation.valueQuantity).toEqual({
      value: 12,
      unit: 'floors',
      system: UCUM_SYSTEM,
      code: '{floors}'
    });
  });

  it('records a dataAbsentReason when the count is missing', () => {
    expect(mapFloorsToFHIR({ interval: INTERVAL }, meta()).dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapSedentaryPeriodToFHIR', () => {
  it('derives the duration from the interval instead of emitting a value-less assertion', () => {
    const observation = mapSedentaryPeriodToFHIR({ interval: INTERVAL }, meta());

    expect(observation.effectivePeriod).toEqual(PERIOD);
    expect(observation.valueQuantity).toEqual({ value: 30, unit: 'minute', system: UCUM_SYSTEM, code: 'min' });
  });

  it('records a dataAbsentReason when the interval has no end', () => {
    const observation = mapSedentaryPeriodToFHIR({ interval: { startTime: '2026-06-20T12:00:00Z' } }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapStepsToFHIR', () => {
  it('emits the count under LOINC 55423-8 with the shared {steps} annotation', () => {
    const observation = mapStepsToFHIR({ interval: INTERVAL, count: '4210' }, meta());

    expect(observation.code).toEqual({
      coding: [{ system: LOINC, code: '55423-8', display: 'Number of steps in unspecified time Pedometer' }]
    });
    expect(observation.valueQuantity).toEqual({
      value: 4210,
      unit: 'steps',
      system: UCUM_SYSTEM,
      code: '{steps}'
    });
    expect(typeof observation.valueQuantity?.value).toBe('number');
  });

  it('does not read an empty count as zero steps', () => {
    const observation = mapStepsToFHIR({ interval: INTERVAL, count: '' }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapSwimLengthsDataToFHIR', () => {
  it('emits the stroke count as a UCUM annotation', () => {
    const observation = mapSwimLengthsDataToFHIR(
      { interval: INTERVAL, strokeCount: '640', swimStrokeType: 'FREESTYLE' },
      meta()
    );

    expect(observation.valueQuantity).toEqual({
      value: 640,
      unit: 'strokes',
      system: UCUM_SYSTEM,
      code: '{strokes}'
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'swim-stroke-type', display: 'Swim stroke type' }] },
      valueString: 'FREESTYLE'
    });
  });

  it('records a dataAbsentReason when the stroke count is missing', () => {
    expect(mapSwimLengthsDataToFHIR({ interval: INTERVAL }, meta()).dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapTimeInHeartRateZoneToFHIR', () => {
  it('emits the duration as the value and the zone as the method', () => {
    const observation = mapTimeInHeartRateZoneToFHIR({ interval: INTERVAL, heartRateZoneType: 'PEAK' }, meta());

    expect(observation.valueQuantity).toEqual({ value: 30, unit: 'minute', system: UCUM_SYSTEM, code: 'min' });
    expect(observation.method).toEqual({ coding: [{ system: GOOGLE_HEALTH, code: 'PEAK', display: 'PEAK' }] });
  });

  it('records a dataAbsentReason when the interval cannot yield a duration', () => {
    const observation = mapTimeInHeartRateZoneToFHIR({ interval: { startTime: '2026-06-20T12:00:00Z' } }, meta());

    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});
