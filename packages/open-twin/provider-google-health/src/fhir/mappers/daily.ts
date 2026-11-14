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
  compact,
  LOINC_CODINGS,
  SYSTEMS,
  stringComponent,
  UCUM
} from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { health_v4 } from 'googleapis';
import {
  createGoogleObservation,
  type DataPointMeta,
  dateToIsoString,
  ghOptionalNumericComponent,
  ghQuantity,
  loincQuantity,
  toNumber
} from './shared';

/**
 * Every mapper in this file produces a daily aggregate. Where the aggregate shares a
 * LOINC code with a spot reading from `sample.ts`, `Observation.method` says so — a
 * receiver must be able to tell a nightly average from an instantaneous measurement
 * without reading a display string.
 */
const DAILY_AVERAGE_METHOD = codeableConcept({
  system: SYSTEMS.GOOGLE_HEALTH,
  code: 'daily-average',
  display: 'Averaged over one civil day'
});

export function mapDailyHeartRateVariabilityToFHIR(
  data: health_v4.Schema$DailyHeartRateVariability,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'daily-heart-rate-variability',
      category: CATEGORY.VITAL_SIGNS,
      // TODO(clinical-review): no LOINC or SNOMED concept for heart-rate variability
      // was found; this vendor-local code needs sign-off.
      code: {
        system: SYSTEMS.GOOGLE_HEALTH,
        code: 'daily-heart-rate-variability',
        display: 'Daily heart rate variability'
      },
      method: DAILY_AVERAGE_METHOD,
      effectiveDateTime: dateToIsoString(data.date),
      components: [
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'average-heart-rate-variability', display: 'Average HRV (RMSSD)' },
          toNumber(data.averageHeartRateVariabilityMilliseconds),
          UCUM.MILLISECOND
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'deep-sleep-rmssd', display: 'Deep sleep RMSSD' },
          toNumber(data.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
          UCUM.MILLISECOND
        ),
        // Entropy is a genuinely dimensionless quantity, so it carries the UCUM unity
        // rather than no unit at all — a bare magnitude tells a receiver nothing.
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'entropy', display: 'Heartbeat entropy' },
          toNumber(data.entropy),
          UCUM.UNITY
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'non-rem-heart-rate', display: 'Non-REM heart rate' },
          toNumber(data.nonRemHeartRateBeatsPerMinute),
          UCUM.PER_MINUTE
        )
      ]
    },
    meta
  );
}

export function mapDailyHeartRateZonesToFHIR(
  data: health_v4.Schema$DailyHeartRateZones,
  meta: DataPointMeta
): Observation {
  // The zone is part of the component code, not of its display. Two components in one
  // resource sharing `heart-rate-zone-min` are an unordered set of numbers a consumer
  // cannot attribute to a zone.
  const components = compact(
    (data.heartRateZones ?? []).flatMap((zone) => {
      const zoneKey = (zone.heartRateZoneType ?? 'unknown').toLowerCase();
      const zoneLabel = zone.heartRateZoneType ?? 'unknown';
      return [
        ghOptionalNumericComponent(
          {
            system: SYSTEMS.GOOGLE_HEALTH,
            code: `heart-rate-zone-${zoneKey}-min`,
            display: `${zoneLabel} min heart rate`
          },
          toNumber(zone.minBeatsPerMinute),
          UCUM.PER_MINUTE
        ),
        ghOptionalNumericComponent(
          {
            system: SYSTEMS.GOOGLE_HEALTH,
            code: `heart-rate-zone-${zoneKey}-max`,
            display: `${zoneLabel} max heart rate`
          },
          toNumber(zone.maxBeatsPerMinute),
          UCUM.PER_MINUTE
        )
      ];
    })
  );

  return createGoogleObservation(
    {
      measure: 'daily-heart-rate-zones',
      category: CATEGORY.VITAL_SIGNS,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'daily-heart-rate-zones', display: 'Daily heart rate zones' },
      effectiveDateTime: dateToIsoString(data.date),
      components
    },
    meta
  );
}

export function mapDailyOxygenSaturationToFHIR(
  data: health_v4.Schema$DailyOxygenSaturation,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'daily-oxygen-saturation',
      category: CATEGORY.VITAL_SIGNS,
      code: [
        LOINC_CODINGS.OXYGEN_SATURATION,
        {
          system: SYSTEMS.GOOGLE_HEALTH,
          code: 'daily-oxygen-saturation',
          display: 'Daily average oxygen saturation'
        }
      ],
      method: DAILY_AVERAGE_METHOD,
      effectiveDateTime: dateToIsoString(data.date),
      expectsValue: true,
      valueQuantity: loincQuantity(LOINC_CODINGS.OXYGEN_SATURATION.code, toNumber(data.averagePercentage)),
      components: [
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'lower-bound-percentage', display: 'Lower bound oxygen saturation' },
          toNumber(data.lowerBoundPercentage),
          UCUM.PERCENT
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'upper-bound-percentage', display: 'Upper bound oxygen saturation' },
          toNumber(data.upperBoundPercentage),
          UCUM.PERCENT
        ),
        ghOptionalNumericComponent(
          {
            system: SYSTEMS.GOOGLE_HEALTH,
            code: 'standard-deviation-percentage',
            display: 'Oxygen saturation standard deviation'
          },
          toNumber(data.standardDeviationPercentage),
          UCUM.PERCENT
        )
      ]
    },
    meta
  );
}

export function mapDailyRespiratoryRateToFHIR(
  data: health_v4.Schema$DailyRespiratoryRate,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'daily-respiratory-rate',
      category: CATEGORY.VITAL_SIGNS,
      code: [
        { system: SYSTEMS.LOINC, code: '9279-1', display: 'Respiratory rate' },
        { system: SYSTEMS.GOOGLE_HEALTH, code: 'daily-respiratory-rate', display: 'Daily average respiratory rate' }
      ],
      method: DAILY_AVERAGE_METHOD,
      effectiveDateTime: dateToIsoString(data.date),
      expectsValue: true,
      valueQuantity: loincQuantity('9279-1', toNumber(data.breathsPerMinute))
    },
    meta
  );
}

export function mapDailyRestingHeartRateToFHIR(
  data: health_v4.Schema$DailyRestingHeartRate,
  meta: DataPointMeta
): Observation {
  const calculationMethod = data.dailyRestingHeartRateMetadata?.calculationMethod;

  return createGoogleObservation(
    {
      measure: 'daily-resting-heart-rate',
      category: CATEGORY.VITAL_SIGNS,
      code: { system: SYSTEMS.LOINC, code: '40443-4', display: 'Heart rate --resting' },
      method: calculationMethod
        ? codeableConcept({ system: SYSTEMS.GOOGLE_HEALTH, code: calculationMethod, display: calculationMethod })
        : undefined,
      effectiveDateTime: dateToIsoString(data.date),
      expectsValue: true,
      valueQuantity: loincQuantity('40443-4', toNumber(data.beatsPerMinute))
    },
    meta
  );
}

export function mapDailySleepTemperatureDerivationsToFHIR(
  data: health_v4.Schema$DailySleepTemperatureDerivations,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'daily-sleep-temperature-derivations',
      category: CATEGORY.VITAL_SIGNS,
      // TODO(clinical-review): LOINC has no concept for a skin-temperature deviation
      // from a personal baseline. 8310-5 means an *absolute* body temperature and must
      // not be used here — a receiver storing "body temperature = 0.3" reads a lethal
      // value. Vendor-local codes stand until a reviewer signs them off.
      code: {
        system: SYSTEMS.GOOGLE_HEALTH,
        code: 'daily-sleep-temperature-derivations',
        display: 'Daily sleep temperature derivations'
      },
      effectiveDateTime: dateToIsoString(data.date),
      components: [
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'nightly-temperature', display: 'Nightly skin temperature' },
          toNumber(data.nightlyTemperatureCelsius),
          UCUM.CELSIUS
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'baseline-temperature', display: 'Baseline skin temperature' },
          toNumber(data.baselineTemperatureCelsius),
          UCUM.CELSIUS
        ),
        // UCUM sections 21-22: `Cel` is a special unit on an interval scale and denotes
        // a *point*. A dispersion is a difference, and a difference is `K`. The two are
        // numerically equal as intervals, so only the coding changes.
        ghOptionalNumericComponent(
          {
            system: SYSTEMS.GOOGLE_HEALTH,
            code: 'relative-nightly-stddev-30d',
            display: 'Relative nightly temperature standard deviation (30d)'
          },
          toNumber(data.relativeNightlyStddev30dCelsius),
          UCUM.KELVIN
        )
      ]
    },
    meta
  );
}

export function mapDailyVo2MaxToFHIR(data: health_v4.Schema$DailyVO2Max, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'daily-vo2-max',
      category: CATEGORY.VITAL_SIGNS,
      // Deliberately vendor-local, unlike the sample mappers: LOINC 94122-9 is a
      // point-in-time peak during exercise, and a daily rollup of a device estimate is
      // neither. This is the pattern the sample VO2 max mappers now follow in reverse —
      // they keep the LOINC axis and add a vendor coding to stay distinguishable.
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'daily-vo2-max', display: 'Daily VO2 max' },
      method: codeableConcept({
        system: SYSTEMS.GOOGLE_HEALTH,
        code: data.estimated === false ? 'measured' : 'device-estimate',
        display: data.estimated === false ? 'Measured' : 'Device-estimated'
      }),
      effectiveDateTime: dateToIsoString(data.date),
      expectsValue: true,
      valueQuantity: ghQuantity(toNumber(data.vo2Max), UCUM.ML_PER_KG_PER_MIN),
      components: [
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'cardio-fitness-level', display: 'Cardio fitness level' },
          data.cardioFitnessLevel
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'vo2-max-covariance', display: 'VO2 max covariance' },
          toNumber(data.vo2MaxCovariance),
          UCUM.UNITY
        )
      ]
    },
    meta
  );
}
