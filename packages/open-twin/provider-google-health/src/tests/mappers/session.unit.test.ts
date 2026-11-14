import type { health_v4 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import {
  mapElectrocardiogramToFHIR,
  mapExerciseToFHIR,
  mapHydrationLogToFHIR,
  mapIrregularRhythmNotificationToFHIR,
  mapNutritionLogToFHIR,
  mapSleepToFHIR
} from '../../fhir/mappers/session';
import {
  ABSENT,
  GOOGLE_HEALTH,
  GOOGLE_HEALTH_IDENTIFIER,
  LOINC,
  meta,
  OBSERVATION_CATEGORY,
  UCUM_SYSTEM
} from '../support/context';

const INTERVAL: health_v4.Schema$SessionTimeInterval = {
  startTime: '2026-06-20T12:00:00Z',
  endTime: '2026-06-20T12:30:00Z'
};

describe('mapElectrocardiogramToFHIR', () => {
  const base: health_v4.Schema$Electrocardiogram = {
    interval: INTERVAL,
    beatsPerMinuteAvg: '70',
    resultClassification: 'normal',
    samplingFrequencyHertz: 250,
    leadNumber: 12,
    medicalDeviceInfo: { deviceModel: 'ECG Model X' }
  };

  it('does not put the document-scale LOINC 11524-6 on an Observation carrying numbers', () => {
    // 11524-6 "EKG study" has SCALE = Doc. It names a report, not a measurement.
    const observation = mapElectrocardiogramToFHIR(base, meta());

    expect(observation.code).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'electrocardiogram', display: 'Electrocardiogram' }]
    });
    expect(JSON.stringify(observation)).not.toContain('11524-6');
    expect(observation.category).toEqual([
      { coding: [{ system: OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }
    ]);
  });

  it('gives every numeric component a unit', () => {
    const observation = mapElectrocardiogramToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'average-heart-rate', display: 'Average heart rate' }] },
      valueQuantity: { value: 70, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'sampling-frequency-hertz', display: 'Sampling frequency' }] },
      valueQuantity: { value: 250, unit: 'hertz', system: UCUM_SYSTEM, code: 'Hz' }
    });
    // Previously `{ value: 12 }` — a dimensionless magnitude with no way to know what
    // it measures.
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'lead-number', display: 'Number of leads' }] },
      valueQuantity: { value: 12, unit: 'leads', system: UCUM_SYSTEM, code: '{leads}' }
    });
  });

  it('maps medical device info to the device field', () => {
    expect(mapElectrocardiogramToFHIR(base, meta()).device).toEqual({ display: 'ECG Model X' });
  });
});

describe('mapExerciseToFHIR', () => {
  const base: health_v4.Schema$Exercise = {
    interval: INTERVAL,
    displayName: 'Morning Run',
    exerciseType: 'RUNNING',
    metricsSummary: {
      activeZoneMinutes: '30',
      averageHeartRateBeatsPerMinute: '150',
      steps: '2000',
      caloriesKcal: 300,
      distanceMillimeters: 5_000_000,
      elevationGainMillimeters: 42_000
    }
  };

  it("puts the vendor's session label in code.text, not in a code display", () => {
    const observation = mapExerciseToFHIR(base, meta());

    expect(observation.code).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'exercise', display: 'Exercise' }],
      text: 'Morning Run'
    });
    expect(observation.category).toEqual([
      { coding: [{ system: OBSERVATION_CATEGORY, code: 'activity', display: 'Activity' }] }
    ]);
  });

  it('converts the distance and elevation components from millimetres to metres', () => {
    const observation = mapExerciseToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'distance', display: 'Distance' }] },
      valueQuantity: { value: 5000, unit: 'meter', system: UCUM_SYSTEM, code: 'm' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'elevation-gain', display: 'Elevation gain' }] },
      valueQuantity: { value: 42, unit: 'meter', system: UCUM_SYSTEM, code: 'm' }
    });
  });

  it('gives the step component the shared LOINC code and UCUM annotation', () => {
    const observation = mapExerciseToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: LOINC, code: '55423-8', display: 'Number of steps in unspecified time Pedometer' }]
      },
      valueQuantity: { value: 2000, unit: 'steps', system: UCUM_SYSTEM, code: '{steps}' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: LOINC, code: '41981-2', display: 'Calories burned' }] },
      valueQuantity: { value: 300, unit: 'kilocalorie', system: UCUM_SYSTEM, code: 'kcal' }
    });
  });
});

describe('mapHydrationLogToFHIR', () => {
  const base: health_v4.Schema$HydrationLog = { interval: INTERVAL, amountConsumed: { milliliters: 500 } };

  it('carries a category, under this connector code system because HL7 has no nutrition code', () => {
    const observation = mapHydrationLogToFHIR(base, meta());

    expect(observation.category).toEqual([
      { coding: [{ system: GOOGLE_HEALTH, code: 'nutrition', display: 'Nutrition' }] }
    ]);
    expect(observation.valueQuantity).toEqual({
      value: 500,
      unit: 'milliliter',
      system: UCUM_SYSTEM,
      code: 'mL'
    });
  });

  it('records a dataAbsentReason when the amount is missing', () => {
    expect(mapHydrationLogToFHIR({ interval: INTERVAL }, meta()).dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapIrregularRhythmNotificationToFHIR', () => {
  it('gives the alert-window count a unit', () => {
    const observation = mapIrregularRhythmNotificationToFHIR(
      {
        interval: INTERVAL,
        alertWindows: [{ positive: true }, { positive: true }],
        medicalDeviceInfo: { deviceModel: 'Pixel Watch' }
      },
      meta()
    );

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'alert-window-count', display: 'Alert window count' }] },
      valueQuantity: { value: 2, unit: 'windows', system: UCUM_SYSTEM, code: '{windows}' }
    });
    expect(observation.device).toEqual({ display: 'Pixel Watch' });
  });

  it('omits the count component when no alert windows are reported', () => {
    expect(mapIrregularRhythmNotificationToFHIR({ interval: INTERVAL }, meta()).component).toBeUndefined();
  });
});

describe('mapNutritionLogToFHIR', () => {
  it('maps the intake quantities with units and a nutrition category', () => {
    const observation = mapNutritionLogToFHIR(
      {
        interval: INTERVAL,
        foodDisplayName: 'Porridge',
        mealType: 'BREAKFAST',
        energy: { kcal: 320 },
        totalCarbohydrate: { grams: 54 },
        totalFat: { grams: 6 }
      },
      meta()
    );

    expect(observation.category).toEqual([
      { coding: [{ system: GOOGLE_HEALTH, code: 'nutrition', display: 'Nutrition' }] }
    ]);
    expect(observation.code).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'nutrition-log', display: 'Nutrition log' }],
      text: 'Porridge'
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'energy', display: 'Energy intake' }] },
      valueQuantity: { value: 320, unit: 'kilocalorie', system: UCUM_SYSTEM, code: 'kcal' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'total-carbohydrate', display: 'Total carbohydrate' }] },
      valueQuantity: { value: 54, unit: 'gram', system: UCUM_SYSTEM, code: 'g' }
    });
  });
});

describe('mapSleepToFHIR', () => {
  const base: health_v4.Schema$Sleep = {
    interval: { startTime: '2026-06-20T22:00:00Z', endTime: '2026-06-21T06:00:00Z' },
    type: 'stages',
    metadata: { externalId: 'sleep-abc' },
    summary: {
      minutesAsleep: '420',
      minutesAwake: '30',
      minutesAfterWakeUp: '10',
      minutesInSleepPeriod: '480',
      minutesToFallAsleep: '12',
      stagesSummary: [
        { type: 'DEEP', minutes: '90', count: '4' },
        { type: 'REM', minutes: '110', count: '5' }
      ]
    },
    stages: [
      { type: 'LIGHT', startTime: '2026-06-20T22:00:00Z', endTime: '2026-06-20T23:00:00Z' },
      { type: 'DEEP', startTime: '2026-06-20T23:00:00Z', endTime: '2026-06-21T00:30:00Z' }
    ],
    outOfBedSegments: [{ startTime: '2026-06-21T02:00:00Z', endTime: '2026-06-21T02:10:00Z' }]
  };

  it('emits the hypnogram as child Observations linked by hasMember', () => {
    // The per-stage segments are the substantive content of a sleep record and cannot
    // be reconstructed from the four aggregate minute counts that used to survive.
    const [session, ...children] = mapSleepToFHIR(base, meta());

    expect(children).toHaveLength(3);
    expect(session?.hasMember).toEqual(children.map((child) => ({ reference: `urn:uuid:${child.id}` })));

    expect(children[0]).toMatchObject({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'sleep-stage', display: 'Sleep stage' }] },
      effectivePeriod: { start: '2026-06-20T22:00:00Z', end: '2026-06-20T23:00:00Z' },
      valueCodeableConcept: { coding: [{ system: GOOGLE_HEALTH, code: 'LIGHT', display: 'LIGHT' }] }
    });
    expect(children[1]?.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'duration', display: 'Stage duration' }] },
      valueQuantity: { value: 90, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
    expect(children[2]).toMatchObject({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'out-of-bed-segment', display: 'Out of bed segment' }] },
      valueQuantity: { value: 10, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
  });

  it('carries the stage summary and the previously dropped minutesAfterWakeUp', () => {
    const [session] = mapSleepToFHIR(base, meta());

    expect(session?.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'minutes-after-wake-up', display: 'Minutes after wake up' }] },
      valueQuantity: { value: 10, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
    expect(session?.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'stage-minutes-deep', display: 'Minutes in DEEP' }] },
      valueQuantity: { value: 90, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
  });

  it('uses the shared units for the LOINC sleep durations', () => {
    const [session] = mapSleepToFHIR(base, meta());

    expect(session?.component).toContainEqual({
      code: { coding: [{ system: LOINC, code: '93832-4', display: 'Sleep duration' }] },
      valueQuantity: { value: 420, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
    // LOINC's own example unit for 103213-5 is `/h`, which is dimensionally meaningless
    // for a duration; `min` is emitted pending a term-change request. See DECISIONS.md.
    expect(session?.component).toContainEqual({
      code: { coding: [{ system: LOINC, code: '103213-5', display: 'Duration in bed' }] },
      valueQuantity: { value: 480, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
    expect(session?.component).toContainEqual({
      code: { coding: [{ system: LOINC, code: '103212-7', display: 'Duration of falling asleep' }] },
      valueQuantity: { value: 12, unit: 'minute', system: UCUM_SYSTEM, code: 'min' }
    });
  });

  it("keeps the vendor's external id alongside the derived identifier", () => {
    const [session] = mapSleepToFHIR(base, meta());

    expect(session?.identifier).toContainEqual({ system: GOOGLE_HEALTH_IDENTIFIER, value: 'sleep-abc' });
  });

  it('returns only the session when there are no stages', () => {
    const observations = mapSleepToFHIR({ interval: INTERVAL, summary: { minutesAsleep: '400' } }, meta());

    expect(observations).toHaveLength(1);
    expect(observations[0]?.hasMember).toBeUndefined();
  });
});
