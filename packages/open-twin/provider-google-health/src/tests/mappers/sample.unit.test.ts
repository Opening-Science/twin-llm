import type { health_v4 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import {
  mapBloodGlucoseToFHIR,
  mapBodyFatToFHIR,
  mapCoreBodyTemperatureToFHIR,
  mapHeartRateToFHIR,
  mapHeartRateVariabilityToFHIR,
  mapHeightToFHIR,
  mapOxygenSaturationToFHIR,
  mapRespiratoryRateSleepSummaryToFHIR,
  mapRunVo2MaxToFHIR,
  mapVo2MaxToFHIR,
  mapWeightToFHIR
} from '../../fhir/mappers/sample';
import {
  ABSENT,
  CONTEXT,
  GOOGLE_HEALTH,
  GOOGLE_HEALTH_IDENTIFIER,
  LOINC,
  meta,
  OBSERVATION_CATEGORY,
  UCUM_SYSTEM
} from '../support/context';

const SAMPLE_TIME: health_v4.Schema$ObservationSampleTime = { physicalTime: '2026-06-20T12:00:00Z' };

describe('mapBloodGlucoseToFHIR', () => {
  const base: health_v4.Schema$BloodGlucose = {
    sampleTime: SAMPLE_TIME,
    bloodGlucoseMilligramsPerDeciliter: 120,
    mealType: 'fasting',
    measurementTiming: 'before-meal',
    specimen: 'capillary',
    notes: 'Fasting blood glucose measurement'
  };

  it('maps to a vital-signs Observation under the mass-concentration glucose code', () => {
    const observation = mapBloodGlucoseToFHIR(base, meta());

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      subject: CONTEXT.subject,
      category: [{ coding: [{ system: OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }],
      // 2339-0 is MCnc (mg/dL). Google's field is documented as mg/dL, so the code and
      // the unit agree; 15074-8 would require mmol/L.
      code: { coding: [{ system: LOINC, code: '2339-0', display: 'Glucose [Mass/volume] in Blood' }] },
      effectiveDateTime: '2026-06-20T12:00:00Z',
      valueQuantity: { value: 120, unit: 'milligram per deciliter', system: UCUM_SYSTEM, code: 'mg/dL' },
      note: [{ text: 'Fasting blood glucose measurement' }]
    });
  });

  it('omits components for missing optional fields', () => {
    const observation = mapBloodGlucoseToFHIR({ sampleTime: SAMPLE_TIME }, meta());

    expect(observation.component).toBeUndefined();
  });
});

describe('mapBodyFatToFHIR', () => {
  it('maps to a vital-signs Observation with the LOINC code for body fat', () => {
    const observation = mapBodyFatToFHIR({ sampleTime: SAMPLE_TIME, percentage: 25 }, meta());

    expect(observation).toMatchObject({
      code: { coding: [{ system: LOINC, code: '41982-0', display: 'Percentage of body fat Measured' }] },
      valueQuantity: { value: 25, unit: '%', system: UCUM_SYSTEM, code: '%' }
    });
  });

  it('records a dataAbsentReason when the percentage is missing', () => {
    const observation = mapBodyFatToFHIR({ sampleTime: SAMPLE_TIME }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapCoreBodyTemperatureToFHIR', () => {
  const base: health_v4.Schema$CoreBodyTemperature = {
    sampleTime: SAMPLE_TIME,
    temperatureCelsius: 37.5,
    measurementLocation: 'wrist',
    id: 'temp-123'
  };

  it('maps to a vital-signs Observation with the LOINC code for body temperature', () => {
    const observation = mapCoreBodyTemperatureToFHIR(base, meta());

    expect(observation).toMatchObject({
      code: { coding: [{ system: LOINC, code: '8310-5', display: 'Body temperature' }] },
      valueQuantity: { value: 37.5, unit: 'degree Celsius', system: UCUM_SYSTEM, code: 'Cel' },
      component: [
        {
          code: { coding: [{ system: GOOGLE_HEALTH, code: 'measurement-location', display: 'Measurement location' }] },
          valueString: 'wrist'
        }
      ]
    });
    expect(observation.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/bodytemp');
  });

  it("keeps the record's own id alongside the identifier derived from the DataPoint", () => {
    const observation = mapCoreBodyTemperatureToFHIR(
      base,
      meta({ name: 'users/u/dataTypes/core-body-temperature/dataPoints/p1' })
    );

    expect(observation.identifier).toEqual([
      { system: GOOGLE_HEALTH_IDENTIFIER, value: 'users/u/dataTypes/core-body-temperature/dataPoints/p1' },
      { system: GOOGLE_HEALTH_IDENTIFIER, value: 'temp-123' }
    ]);
  });

  it('still carries a deterministic identifier when the record has no id of its own', () => {
    // The natural key is measure plus effective time, so re-syncing the same window
    // yields the same identifier instead of a duplicate resource.
    const observation = mapCoreBodyTemperatureToFHIR({ sampleTime: SAMPLE_TIME, temperatureCelsius: 37.5 }, meta());

    expect(observation.identifier).toEqual([
      { system: GOOGLE_HEALTH_IDENTIFIER, value: 'core-body-temperature|2026-06-20T12:00:00Z' }
    ]);
  });

  it('gives the same id to the same record on a re-sync', () => {
    const first = mapCoreBodyTemperatureToFHIR(base, meta());
    const second = mapCoreBodyTemperatureToFHIR(base, meta());

    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('mapHeartRateToFHIR', () => {
  it('maps to a vital-signs Observation with the profile-fixed /min unit', () => {
    const observation = mapHeartRateToFHIR({ sampleTime: SAMPLE_TIME, beatsPerMinute: '72' }, meta());

    expect(observation).toMatchObject({
      code: { coding: [{ system: LOINC, code: '8867-4', display: 'Heart rate' }] },
      // The R4 heartrate profile *fixes* valueQuantity.code to '/min'. '{beats}/min' is
      // absent from ucum-vitals-common and is a conformance failure.
      valueQuantity: { value: 72, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' }
    });
    expect(typeof observation.valueQuantity?.value).toBe('number');
  });

  it('records a dataAbsentReason when beatsPerMinute is missing', () => {
    const observation = mapHeartRateToFHIR({ sampleTime: SAMPLE_TIME }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });

  it('does not read an empty beatsPerMinute as a heart rate of zero', () => {
    const observation = mapHeartRateToFHIR({ sampleTime: SAMPLE_TIME, beatsPerMinute: '' }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });

  it('carries device and recording-method provenance from the DataPoint envelope', () => {
    const observation = mapHeartRateToFHIR(
      { sampleTime: SAMPLE_TIME, beatsPerMinute: '72' },
      meta({
        dataSource: {
          recordingMethod: 'DERIVED',
          platform: 'FITBIT',
          device: { displayName: 'MobileTrack' },
          application: { packageName: 'com.sec.android.app.shealth' }
        }
      })
    );

    expect(observation.device).toEqual({ display: 'MobileTrack' });
    expect(observation.extension).toEqual([
      {
        url: 'http://opentwin.ch/fhir/StructureDefinition/google-health-data-source',
        extension: [
          { url: 'recordingMethod', valueCode: 'DERIVED' },
          { url: 'platform', valueCode: 'FITBIT' },
          { url: 'application', valueString: 'com.sec.android.app.shealth' }
        ]
      }
    ]);
  });
});

describe('mapHeartRateVariabilityToFHIR', () => {
  const base: health_v4.Schema$HeartRateVariability = {
    sampleTime: SAMPLE_TIME,
    standardDeviationMilliseconds: 45,
    rootMeanSquareOfSuccessiveDifferencesMilliseconds: 50
  };

  it('maps to a vital-signs Observation under the connector code system', () => {
    const observation = mapHeartRateVariabilityToFHIR(base, meta());

    expect(observation).toMatchObject({
      code: { coding: [{ system: GOOGLE_HEALTH, code: 'heart-rate-variability', display: 'Heart rate variability' }] },
      valueQuantity: { value: 50, unit: 'millisecond', system: UCUM_SYSTEM, code: 'ms' },
      component: [
        {
          code: {
            coding: [{ system: GOOGLE_HEALTH, code: 'standard-deviation', display: 'HRV standard deviation (SDNN)' }]
          },
          valueQuantity: { value: 45, unit: 'millisecond', system: UCUM_SYSTEM, code: 'ms' }
        }
      ]
    });
  });

  it('omits components for missing standardDeviationMilliseconds', () => {
    const observation = mapHeartRateVariabilityToFHIR(
      { sampleTime: SAMPLE_TIME, rootMeanSquareOfSuccessiveDifferencesMilliseconds: 50 },
      meta()
    );

    expect(observation.component).toBeUndefined();
  });
});

describe('mapHeightToFHIR', () => {
  it('converts the millimetres Google sends into the centimetres the profile requires', () => {
    const observation = mapHeightToFHIR({ sampleTime: SAMPLE_TIME, heightMillimeters: '1750' }, meta());

    // ucum-bodylength is a *required* binding to exactly {cm, [in_i]}; 'mm' is a
    // binding violation that a validating receiver rejects.
    expect(observation).toMatchObject({
      code: { coding: [{ system: LOINC, code: '8302-2', display: 'Body height' }] },
      valueQuantity: { value: 175, unit: 'centimeter', system: UCUM_SYSTEM, code: 'cm' }
    });
    expect(observation.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/bodyheight');
  });

  it('records a dataAbsentReason when heightMillimeters is missing', () => {
    const observation = mapHeightToFHIR({ sampleTime: SAMPLE_TIME }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapOxygenSaturationToFHIR', () => {
  it('carries a vendor coding so a spot reading is distinguishable from the daily average', () => {
    const observation = mapOxygenSaturationToFHIR({ sampleTime: SAMPLE_TIME, percentage: 98 }, meta());

    expect(observation.code).toEqual({
      coding: [
        { system: LOINC, code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry' },
        { system: GOOGLE_HEALTH, code: 'oxygen-saturation', display: 'Spot oxygen saturation' }
      ]
    });
    expect(observation.valueQuantity).toEqual({ value: 98, unit: '%', system: UCUM_SYSTEM, code: '%' });
  });

  it('records a dataAbsentReason when the percentage is missing', () => {
    const observation = mapOxygenSaturationToFHIR({ sampleTime: SAMPLE_TIME }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapRespiratoryRateSleepSummaryToFHIR', () => {
  const base: health_v4.Schema$RespiratoryRateSleepSummary = {
    sampleTime: SAMPLE_TIME,
    deepSleepStats: { breathsPerMinute: 15 },
    fullSleepStats: { breathsPerMinute: 16 },
    lightSleepStats: { breathsPerMinute: 17 },
    remSleepStats: { breathsPerMinute: 18 }
  };

  it('says in Observation.method that the value is a sleep-period mean', () => {
    const observation = mapRespiratoryRateSleepSummaryToFHIR(base, meta());

    expect(observation.code).toEqual({
      coding: [
        { system: LOINC, code: '9279-1', display: 'Respiratory rate' },
        {
          system: GOOGLE_HEALTH,
          code: 'respiratory-rate-sleep-summary',
          display: 'Respiratory rate over the sleep period'
        }
      ]
    });
    expect(observation.method).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'sleep-period-average', display: 'Averaged over the sleep period' }]
    });
    expect(observation.valueQuantity).toEqual({ value: 16, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' });
  });

  it('maps the per-stage rates into components', () => {
    const observation = mapRespiratoryRateSleepSummaryToFHIR(base, meta());

    expect(observation.component).toContainEqual({
      code: {
        coding: [
          { system: GOOGLE_HEALTH, code: 'deep-sleep-breaths-per-minute', display: 'Deep sleep respiratory rate' }
        ]
      },
      valueQuantity: { value: 15, unit: 'per minute', system: UCUM_SYSTEM, code: '/min' }
    });
  });

  it('omits components for missing sleep stats', () => {
    const observation = mapRespiratoryRateSleepSummaryToFHIR({ sampleTime: SAMPLE_TIME }, meta());

    expect(observation.component).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});

describe('VO2 max under LOINC 94122-9', () => {
  const VO2_DISPLAY = 'Oxygen consumption (VO2)/Body weight [Volume Rate Content] --peak during exercise';

  it('separates the running estimate from the general estimate by method, not by display', () => {
    const run = mapRunVo2MaxToFHIR({ sampleTime: SAMPLE_TIME, runVo2Max: 45 }, meta());
    const general = mapVo2MaxToFHIR({ sampleTime: SAMPLE_TIME, vo2Max: 50, measurementMethod: 'RESTING' }, meta());

    expect(run.code).toEqual({
      coding: [
        { system: LOINC, code: '94122-9', display: VO2_DISPLAY },
        { system: GOOGLE_HEALTH, code: 'run-vo2-max', display: 'Running VO2 max' }
      ]
    });
    expect(general.code).toEqual({
      coding: [
        { system: LOINC, code: '94122-9', display: VO2_DISPLAY },
        { system: GOOGLE_HEALTH, code: 'vo2-max', display: 'VO2 max' }
      ]
    });

    expect(run.method).toEqual({
      coding: [{ system: GOOGLE_HEALTH, code: 'run-test-estimate', display: 'Estimated from a running test' }]
    });
    expect(general.method).toEqual({
      coding: [
        { system: GOOGLE_HEALTH, code: 'device-estimate', display: 'Device-estimated' },
        { system: GOOGLE_HEALTH, code: 'RESTING', display: 'RESTING' }
      ]
    });

    // The two measures must not collapse onto one another on re-ingestion.
    expect(run.id).not.toBe(general.id);
  });

  it('uses the shared unit for 94122-9', () => {
    const observation = mapVo2MaxToFHIR({ sampleTime: SAMPLE_TIME, vo2Max: 50 }, meta());

    expect(observation.valueQuantity).toEqual({
      value: 50,
      unit: 'milliliter per kilogram per minute',
      system: UCUM_SYSTEM,
      code: 'mL/kg/min'
    });
  });

  it('records a dataAbsentReason when either VO2 max is missing', () => {
    expect(mapRunVo2MaxToFHIR({ sampleTime: SAMPLE_TIME }, meta()).dataAbsentReason).toEqual(ABSENT);
    expect(mapVo2MaxToFHIR({ sampleTime: SAMPLE_TIME }, meta()).dataAbsentReason).toEqual(ABSENT);
  });
});

describe('mapWeightToFHIR', () => {
  it('converts the grams Google sends into kilograms', () => {
    const observation = mapWeightToFHIR({ sampleTime: SAMPLE_TIME, weightGrams: 70000 }, meta());

    expect(observation).toMatchObject({
      code: { coding: [{ system: LOINC, code: '29463-7', display: 'Body weight' }] },
      valueQuantity: { value: 70, unit: 'kilogram', system: UCUM_SYSTEM, code: 'kg' }
    });
    expect(observation.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/bodyweight');
  });

  it('records a dataAbsentReason when weightGrams is missing', () => {
    const observation = mapWeightToFHIR({ sampleTime: SAMPLE_TIME }, meta());

    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual(ABSENT);
  });
});
