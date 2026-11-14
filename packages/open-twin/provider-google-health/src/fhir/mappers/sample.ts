/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
 * GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 * GOTCHA: No live Google Health sandbox fixture yet — structural tests are not an oracle (BUILD-SUMMARY).
 */
import {
  CATEGORY,
  codeableConcept,
  LOINC_CODINGS,
  PROFILES,
  SYSTEMS,
  stringComponent,
  UCUM
} from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { health_v4 } from 'googleapis';
import {
  createGoogleObservation,
  type DataPointMeta,
  ghOptionalNumericComponent,
  ghQuantity,
  gramsToKilograms,
  loincQuantity,
  millimetresToCentimetres,
  sampleTimeToDateTime,
  toNumber
} from './shared';

/**
 * LOINC's official Long Common Name. Two distinct Google measures — a general
 * estimate and a run-test estimate — legitimately share this code, so they are
 * separated by `Observation.method` and a vendor coding, never by a display string:
 * a display is not a matching key for any FHIR search or de-duplication.
 */
const VO2_MAX_DISPLAY = 'Oxygen consumption (VO2)/Body weight [Volume Rate Content] --peak during exercise';

export function mapBloodGlucoseToFHIR(data: health_v4.Schema$BloodGlucose, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'blood-glucose',
      category: CATEGORY.VITAL_SIGNS,
      // 2339-0 is *mass* concentration (MCnc, mg/dL); 15074-8 is substance
      // concentration (mmol/L). Both have UNITSREQUIRED=Y, so the pair must agree.
      // Google's field is `bloodGlucoseMilligramsPerDeciliter`, documented in the v4
      // discovery document as "Blood glucose level concentration in mg/dL", which
      // settles it for this connector: 2339-0 with mg/dL.
      code: { system: SYSTEMS.LOINC, code: '2339-0', display: 'Glucose [Mass/volume] in Blood' },
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: ghQuantity(toNumber(data.bloodGlucoseMilligramsPerDeciliter), UCUM.MG_PER_DL),
      components: [
        stringComponent({ system: SYSTEMS.GOOGLE_HEALTH, code: 'meal-type', display: 'Meal type' }, data.mealType),
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'measurement-timing', display: 'Measurement timing' },
          data.measurementTiming
        ),
        stringComponent({ system: SYSTEMS.GOOGLE_HEALTH, code: 'specimen', display: 'Specimen source' }, data.specimen)
      ],
      note: data.notes ?? undefined
    },
    meta
  );
}

export function mapBodyFatToFHIR(data: health_v4.Schema$BodyFat, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'body-fat',
      category: CATEGORY.VITAL_SIGNS,
      code: { system: SYSTEMS.LOINC, code: '41982-0', display: 'Percentage of body fat Measured' },
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: loincQuantity('41982-0', toNumber(data.percentage))
    },
    meta
  );
}

export function mapCoreBodyTemperatureToFHIR(
  data: health_v4.Schema$CoreBodyTemperature,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'core-body-temperature',
      category: CATEGORY.VITAL_SIGNS,
      code: { system: SYSTEMS.LOINC, code: '8310-5', display: 'Body temperature' },
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: loincQuantity('8310-5', toNumber(data.temperatureCelsius)),
      components: [
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'measurement-location', display: 'Measurement location' },
          data.measurementLocation
        )
      ],
      identifier: data.id ? [{ system: SYSTEMS.GOOGLE_HEALTH_IDENTIFIER, value: data.id }] : undefined,
      profiles: [PROFILES.BODY_TEMPERATURE]
    },
    meta
  );
}

export function mapHeartRateToFHIR(data: health_v4.Schema$HeartRate, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'heart-rate',
      category: CATEGORY.VITAL_SIGNS,
      code: LOINC_CODINGS.HEART_RATE,
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: loincQuantity(LOINC_CODINGS.HEART_RATE.code, toNumber(data.beatsPerMinute)),
      components: [
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'motion-context', display: 'Motion context' },
          data.metadata?.motionContext
        ),
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'sensor-location', display: 'Sensor location' },
          data.metadata?.sensorLocation
        )
      ],
      profiles: [PROFILES.HEART_RATE]
    },
    meta
  );
}

export function mapHeartRateVariabilityToFHIR(
  data: health_v4.Schema$HeartRateVariability,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'heart-rate-variability',
      category: CATEGORY.VITAL_SIGNS,
      // TODO(clinical-review): no LOINC or SNOMED concept for RMSSD heart-rate
      // variability was found. A vendor-local code needs sign-off, or replacement
      // with a standard concept if a reviewer identifies one.
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'heart-rate-variability', display: 'Heart rate variability' },
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: ghQuantity(toNumber(data.rootMeanSquareOfSuccessiveDifferencesMilliseconds), UCUM.MILLISECOND),
      components: [
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'standard-deviation', display: 'HRV standard deviation (SDNN)' },
          toNumber(data.standardDeviationMilliseconds),
          UCUM.MILLISECOND
        )
      ]
    },
    meta
  );
}

export function mapHeightToFHIR(data: health_v4.Schema$Height, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'height',
      category: CATEGORY.VITAL_SIGNS,
      code: { system: SYSTEMS.LOINC, code: '8302-2', display: 'Body height' },
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      // The R4 Body height profile binds valueQuantity.code to exactly {cm, [in_i]}.
      // `mm` is a required-binding violation, so the millimetres Google sends are
      // converted rather than relabelled. No rounding: FHIR decimal keeps precision.
      valueQuantity: loincQuantity('8302-2', millimetresToCentimetres(data.heightMillimeters)),
      profiles: [PROFILES.BODY_HEIGHT]
    },
    meta
  );
}

export function mapOxygenSaturationToFHIR(data: health_v4.Schema$OxygenSaturation, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'oxygen-saturation',
      category: CATEGORY.VITAL_SIGNS,
      // The daily aggregate uses the same LOINC code. The vendor coding is what makes
      // a spot reading distinguishable from a daily average in a queryable field.
      code: [
        LOINC_CODINGS.OXYGEN_SATURATION,
        { system: SYSTEMS.GOOGLE_HEALTH, code: 'oxygen-saturation', display: 'Spot oxygen saturation' }
      ],
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: loincQuantity(LOINC_CODINGS.OXYGEN_SATURATION.code, toNumber(data.percentage)),
      profiles: [PROFILES.OXYGEN_SATURATION]
    },
    meta
  );
}

export function mapRespiratoryRateSleepSummaryToFHIR(
  data: health_v4.Schema$RespiratoryRateSleepSummary,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'respiratory-rate-sleep-summary',
      category: CATEGORY.VITAL_SIGNS,
      code: [
        { system: SYSTEMS.LOINC, code: '9279-1', display: 'Respiratory rate' },
        {
          system: SYSTEMS.GOOGLE_HEALTH,
          code: 'respiratory-rate-sleep-summary',
          display: 'Respiratory rate over the sleep period'
        }
      ],
      // The value is a mean over the whole sleep period, not an instantaneous rate.
      method: codeableConcept({
        system: SYSTEMS.GOOGLE_HEALTH,
        code: 'sleep-period-average',
        display: 'Averaged over the sleep period'
      }),
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: loincQuantity('9279-1', toNumber(data.fullSleepStats?.breathsPerMinute)),
      components: [
        ghOptionalNumericComponent(
          {
            system: SYSTEMS.GOOGLE_HEALTH,
            code: 'deep-sleep-breaths-per-minute',
            display: 'Deep sleep respiratory rate'
          },
          toNumber(data.deepSleepStats?.breathsPerMinute),
          UCUM.PER_MINUTE
        ),
        ghOptionalNumericComponent(
          {
            system: SYSTEMS.GOOGLE_HEALTH,
            code: 'light-sleep-breaths-per-minute',
            display: 'Light sleep respiratory rate'
          },
          toNumber(data.lightSleepStats?.breathsPerMinute),
          UCUM.PER_MINUTE
        ),
        ghOptionalNumericComponent(
          {
            system: SYSTEMS.GOOGLE_HEALTH,
            code: 'rem-sleep-breaths-per-minute',
            display: 'REM sleep respiratory rate'
          },
          toNumber(data.remSleepStats?.breathsPerMinute),
          UCUM.PER_MINUTE
        )
      ]
    },
    meta
  );
}

export function mapRunVo2MaxToFHIR(data: health_v4.Schema$RunVO2Max, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'run-vo2-max',
      category: CATEGORY.VITAL_SIGNS,
      code: [
        { system: SYSTEMS.LOINC, code: '94122-9', display: VO2_MAX_DISPLAY },
        { system: SYSTEMS.GOOGLE_HEALTH, code: 'run-vo2-max', display: 'Running VO2 max' }
      ],
      method: codeableConcept({
        system: SYSTEMS.GOOGLE_HEALTH,
        code: 'run-test-estimate',
        display: 'Estimated from a running test'
      }),
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: loincQuantity('94122-9', toNumber(data.runVo2Max))
    },
    meta
  );
}

export function mapVo2MaxToFHIR(data: health_v4.Schema$VO2Max, meta: DataPointMeta): Observation {
  // 94122-9 means "peak during exercise". A watch- or ring-derived VO2 max is a model
  // output, not a measured peak from a graded exercise test, so the method records how
  // the number was arrived at wherever Google states it.
  const method = codeableConcept([
    { system: SYSTEMS.GOOGLE_HEALTH, code: 'device-estimate', display: 'Device-estimated' },
    ...(data.measurementMethod
      ? [{ system: SYSTEMS.GOOGLE_HEALTH, code: data.measurementMethod, display: data.measurementMethod }]
      : [])
  ]);

  return createGoogleObservation(
    {
      measure: 'vo2-max',
      category: CATEGORY.VITAL_SIGNS,
      code: [
        { system: SYSTEMS.LOINC, code: '94122-9', display: VO2_MAX_DISPLAY },
        { system: SYSTEMS.GOOGLE_HEALTH, code: 'vo2-max', display: 'VO2 max' }
      ],
      method,
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      valueQuantity: loincQuantity('94122-9', toNumber(data.vo2Max))
    },
    meta
  );
}

export function mapWeightToFHIR(data: health_v4.Schema$Weight, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'weight',
      category: CATEGORY.VITAL_SIGNS,
      code: { system: SYSTEMS.LOINC, code: '29463-7', display: 'Body weight' },
      effectiveDateTime: sampleTimeToDateTime(data.sampleTime),
      expectsValue: true,
      // Google sends grams. `kg` is what the R4 Body weight profile and every real
      // consumer expects; 86000 published as a body weight is not a plausible number.
      valueQuantity: loincQuantity('29463-7', gramsToKilograms(data.weightGrams)),
      note: data.notes ?? undefined,
      profiles: [PROFILES.BODY_WEIGHT]
    },
    meta
  );
}
