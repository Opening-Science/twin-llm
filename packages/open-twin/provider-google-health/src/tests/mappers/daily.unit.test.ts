import type { health_v4 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import {
  mapDailyHeartRateVariabilityToFHIR,
  mapDailyHeartRateZonesToFHIR,
  mapDailyOxygenSaturationToFHIR,
  mapDailyRespiratoryRateToFHIR,
  mapDailyRestingHeartRateToFHIR,
  mapDailySleepTemperatureDerivationsToFHIR,
  mapDailyVo2MaxToFHIR
} from '../../fhir/mappers/daily';
import { ABSENT, GOOGLE_HEALTH, LOINC, meta, OBSERVATION_CATEGORY, UCUM_SYSTEM } from '../support/context';

const DATE: health_v4.Schema$Date = { year: 2026, month: 6, day: 20 };

const DAILY_AVERAGE = {
  coding: [{ system: GOOGLE_HEALTH, code: 'daily-average', display: 'Averaged over one civil day' }]
};

describe('mapDailyHeartRateVariabilityToFHIR', () => {
  const base: health_v4.Schema$DailyHeartRateVariability = {
    date: DATE,
    averageHeartRateVariabilityMilliseconds: 45,
    deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 60,
    entropy: 2.5,
    nonRemHeartRateBeatsPerMinute: '55'
  };

  it('maps to a vital-signs Observation under the connector code system', () => {
    const observation = mapDailyHeartRateVariabilityToFHIR(base, meta());

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }],
      code: {
        coding: [
          { system: GOOGLE_HEALTH, code: 'daily-heart-rate-variability', display: 'Daily heart rate variability' }
        ]
      }
    });
  });

  it('formats the date into a padded ISO effectiveDateTime', () => {
    const observation = mapDailyHeartRateVariabilityToFHIR({ ...base, date: { year: 2026, month: 1, day: 5 } }, meta());

    expect(observation.effectiveDateTime).toBe('2026-01-05');
  });

  it('gives the dimensionless entropy the UCUM unity rather than no unit at all', () => {
    const observation = mapDailyHeartRateVariabilityToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: GOOGLE_HEALTH, code: 'average-heart-rate-variability', display: 'Average HRV (RMSSD)' }]
      },
      valueQuantity: { value: 45, unit: 'millisecond', system: UCUM_SYSTEM, code: 'ms' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'entropy', display: 'Heartbeat entropy' }] },
      valueQuantity: { value: 2.5, unit: '1', system: UCUM_SYSTEM, code: '1' }
    });
  });

  it('omits components for missing metrics', () => {
    const observation = mapDailyHeartRateVariabilityToFHIR({ date: DATE }, meta());

    expect(observation.component).toBeUndefined();
  });
});

describe('mapDailyHeartRateZonesToFHIR', () => {
  const base: health_v4.Schema$DailyHeartRateZones = {
    date: DATE,
    heartRateZones: [
      { heartRateZoneType: 'FAT_BURN', minBeatsPerMinute: '100', maxBeatsPerMinute: '140' },
      { heartRateZoneType: 'CARDIO', minBeatsPerMinute: '140', maxBeatsPerMinute: '160' }
    ]
  };

  it('puts the zone in the component code so two zones never collide', () => {
    // Repeating one code per zone and varying only the display leaves a consumer
    // selecting component.code an unordered bag of numbers it cannot attribute.
    const observation = mapDailyHeartRateZonesToFHIR(base, meta());
    const codes = observation.component?.map((component) => component.code.coding?.[0]?.code);

    expect(codes).toEqual([
      'heart-rate-zone-fat_burn-min',
      'heart-rate-zone-fat_burn-max',
      'heart-rate-zone-cardio-min',
      'heart-rate-zone-cardio-max'
    ]);
    expect(new Set(codes).size).toBe(4);
  });

  it('maps each zone bound with the per-minute unit', () => {
    const observation = mapDailyHeartRateZonesToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: GOOGLE_HEALTH, code: 'heart-rate-zone-cardio-min', display: 'CARDIO min heart rate' }]
      },
      valueQuantity: { value: 140, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' }
    });
  });

  it('falls back to an unknown zone key when the type is missing', () => {
    const observation = mapDailyHeartRateZonesToFHIR(
      { date: DATE, heartRateZones: [{ minBeatsPerMinute: '100' }] },
      meta()
    );

    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: GOOGLE_HEALTH, code: 'heart-rate-zone-unknown-min', display: 'unknown min heart rate' }]
      },
      valueQuantity: { value: 100, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' }
    });
  });

  it('produces no components when there are no zones', () => {
    expect(mapDailyHeartRateZonesToFHIR({ date: DATE }, meta()).component).toBeUndefined();
  });
});

describe('mapDailyOxygenSaturationToFHIR', () => {
  const base: health_v4.Schema$DailyOxygenSaturation = {
    date: DATE,
    averagePercentage: 97,
    lowerBoundPercentage: 95,
    upperBoundPercentage: 99,
    standardDeviationPercentage: 1.2
  };

  it('carries a vendor coding and a daily-average method beside LOINC 59408-5', () => {
    const observation = mapDailyOxygenSaturationToFHIR(base, meta());

    expect(observation.code).toEqual({
      coding: [
        { system: LOINC, code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry' },
        { system: GOOGLE_HEALTH, code: 'daily-oxygen-saturation', display: 'Daily average oxygen saturation' }
      ]
    });
    expect(observation.method).toEqual(DAILY_AVERAGE);
    expect(observation.valueQuantity).toEqual({ value: 97, unit: '%', system: UCUM_SYSTEM, code: '%' });
  });

  it('records a dataAbsentReason when the average is missing', () => {
    const { averagePercentage: _average, ...withoutAverage } = base;
    const observation = mapDailyOxygenSaturationToFHIR(withoutAverage, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });

  it('maps the bound and deviation components', () => {
    const observation = mapDailyOxygenSaturationToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: GOOGLE_HEALTH, code: 'lower-bound-percentage', display: 'Lower bound oxygen saturation' }]
      },
      valueQuantity: { value: 95, unit: '%', system: UCUM_SYSTEM, code: '%' }
    });
    expect(observation.component).toContainEqual({
      code: {
        coding: [{ system: GOOGLE_HEALTH, code: 'upper-bound-percentage', display: 'Upper bound oxygen saturation' }]
      },
      valueQuantity: { value: 99, unit: '%', system: UCUM_SYSTEM, code: '%' }
    });
  });
});

describe('mapDailyRespiratoryRateToFHIR', () => {
  it('carries a vendor coding and a daily-average method beside LOINC 9279-1', () => {
    const observation = mapDailyRespiratoryRateToFHIR({ date: DATE, breathsPerMinute: 14 }, meta());

    expect(observation.code).toEqual({
      coding: [
        { system: LOINC, code: '9279-1', display: 'Respiratory rate' },
        { system: GOOGLE_HEALTH, code: 'daily-respiratory-rate', display: 'Daily average respiratory rate' }
      ]
    });
    expect(observation.method).toEqual(DAILY_AVERAGE);
    expect(observation.valueQuantity).toEqual({ value: 14, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' });
  });

  it('records a dataAbsentReason when breaths per minute is missing', () => {
    const observation = mapDailyRespiratoryRateToFHIR({ date: DATE }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapDailyRestingHeartRateToFHIR', () => {
  it('maps the resting heart rate with the profile-fixed /min unit', () => {
    const observation = mapDailyRestingHeartRateToFHIR({ date: DATE, beatsPerMinute: '58' }, meta());

    expect(observation.code).toEqual({ coding: [{ system: LOINC, code: '40443-4', display: 'Heart rate --resting' }] });
    expect(observation.valueQuantity).toEqual({ value: 58, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' });
  });

  it('maps the calculation method into a coded Observation.method', () => {
    const observation = mapDailyRestingHeartRateToFHIR(
      { date: DATE, beatsPerMinute: '58', dailyRestingHeartRateMetadata: { calculationMethod: 'SLEEP' } },
      meta()
    );

    expect(observation.method).toEqual({ coding: [{ system: GOOGLE_HEALTH, code: 'SLEEP', display: 'SLEEP' }] });
  });

  it('omits the method when metadata has no calculation method', () => {
    expect(mapDailyRestingHeartRateToFHIR({ date: DATE, beatsPerMinute: '58' }, meta()).method).toBeUndefined();
  });
});

describe('mapDailySleepTemperatureDerivationsToFHIR', () => {
  const base: health_v4.Schema$DailySleepTemperatureDerivations = {
    date: DATE,
    nightlyTemperatureCelsius: 36.5,
    baselineTemperatureCelsius: 36.2,
    relativeNightlyStddev30dCelsius: 0.3
  };

  it('keeps Cel for the absolute temperatures', () => {
    const observation = mapDailySleepTemperatureDerivationsToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'nightly-temperature', display: 'Nightly skin temperature' }] },
      valueQuantity: { value: 36.5, unit: 'degree Celsius', system: UCUM_SYSTEM, code: 'Cel' }
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'baseline-temperature', display: 'Baseline skin temperature' }] },
      valueQuantity: { value: 36.2, unit: 'degree Celsius', system: UCUM_SYSTEM, code: 'Cel' }
    });
  });

  it('emits the standard deviation in K, because a dispersion is a difference not a point', () => {
    // UCUM sections 21-22: 'Cel' is a special unit on an interval scale. The magnitude
    // is unchanged — a Celsius interval equals a Kelvin interval — only the code moves.
    const observation = mapDailySleepTemperatureDerivationsToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: {
        coding: [
          {
            system: GOOGLE_HEALTH,
            code: 'relative-nightly-stddev-30d',
            display: 'Relative nightly temperature standard deviation (30d)'
          }
        ]
      },
      valueQuantity: { value: 0.3, unit: 'degree Kelvin', system: UCUM_SYSTEM, code: 'K' }
    });
  });

  it('omits components when temperatures are missing', () => {
    expect(mapDailySleepTemperatureDerivationsToFHIR({ date: DATE }, meta()).component).toBeUndefined();
  });
});

describe('mapDailyVo2MaxToFHIR', () => {
  const base: health_v4.Schema$DailyVO2Max = {
    date: DATE,
    vo2Max: 42,
    cardioFitnessLevel: 'GOOD',
    vo2MaxCovariance: 0.05
  };

  it('stays on a vendor code, because LOINC 94122-9 is a peak during exercise', () => {
    const observation = mapDailyVo2MaxToFHIR(base, meta());

    expect(observation.code).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'daily-vo2-max', display: 'Daily VO2 max' }]
    });
    expect(observation.valueQuantity).toEqual({
      value: 42,
      unit: 'milliliter per kilogram per minute',
      system: UCUM_SYSTEM,
      code: 'mL/kg/min'
    });
    expect(observation.method).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'device-estimate', display: 'Device-estimated' }]
    });
  });

  it('gives the dimensionless covariance the UCUM unity', () => {
    const observation = mapDailyVo2MaxToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'cardio-fitness-level', display: 'Cardio fitness level' }] },
      valueString: 'GOOD'
    });
    expect(observation.component).toContainEqual({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'vo2-max-covariance', display: 'VO2 max covariance' }] },
      valueQuantity: { value: 0.05, unit: '1', system: UCUM_SYSTEM, code: '1' }
    });
  });

  it('records a dataAbsentReason when VO2 max is missing', () => {
    const observation = mapDailyVo2MaxToFHIR({ date: DATE }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});
