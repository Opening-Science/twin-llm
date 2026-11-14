/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
 * GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 * GOTCHA: No live Google Health sandbox fixture yet — structural tests are not an oracle (BUILD-SUMMARY).
 */
import { CATEGORY, codeableConcept, compact, SYSTEMS, stringComponent, UCUM } from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { health_v4 } from 'googleapis';
import {
  createGoogleObservation,
  type DataPointMeta,
  GH_UCUM,
  ghOptionalNumericComponent,
  ghQuantity,
  intervalToPeriod,
  loincQuantity,
  millimetresToMetres,
  periodMinutes,
  toNumber
} from './shared';

export function mapActiveEnergyBurnedToFHIR(
  data: health_v4.Schema$ActiveEnergyBurned,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'active-energy-burned',
      category: CATEGORY.ACTIVITY,
      code: [
        { system: SYSTEMS.LOINC, code: '41981-2', display: 'Calories burned' },
        { system: SYSTEMS.GOOGLE_HEALTH, code: 'active-energy-burned', display: 'Active energy burned' }
      ],
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      valueQuantity: loincQuantity('41981-2', toNumber(data.kcal))
    },
    meta
  );
}

/**
 * Basal energy is a real `DataPoint` member and a direct companion to active energy.
 * It was declared nowhere and mapped nowhere, so the metric was simply unreachable.
 */
export function mapBasalEnergyBurnedToFHIR(data: health_v4.Schema$BasalEnergyBurned, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'basal-energy-burned',
      category: CATEGORY.ACTIVITY,
      code: [
        { system: SYSTEMS.LOINC, code: '41981-2', display: 'Calories burned' },
        { system: SYSTEMS.GOOGLE_HEALTH, code: 'basal-energy-burned', display: 'Basal energy burned' }
      ],
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      valueQuantity: loincQuantity('41981-2', toNumber(data.kcal))
    },
    meta
  );
}

export function mapActiveMinutesToFHIR(data: health_v4.Schema$ActiveMinutes, meta: DataPointMeta): Observation {
  // The activity level belongs in the component code. Repeating one code across every
  // level leaves a consumer with an unordered bag of minutes it cannot attribute.
  const components = compact(
    (data.activeMinutesByActivityLevel ?? []).map((level) => {
      const key = (level.activityLevel ?? 'unknown').toLowerCase();
      return ghOptionalNumericComponent(
        {
          system: SYSTEMS.GOOGLE_HEALTH,
          code: `active-minutes-${key}`,
          display: `Active minutes (${level.activityLevel ?? 'unknown'})`
        },
        toNumber(level.activeMinutes),
        UCUM.MINUTE
      );
    })
  );

  return createGoogleObservation(
    {
      measure: 'active-minutes',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'active-minutes', display: 'Active minutes' },
      effectivePeriod: intervalToPeriod(data.interval),
      components
    },
    meta
  );
}

export function mapActiveZoneMinutesToFHIR(data: health_v4.Schema$ActiveZoneMinutes, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'active-zone-minutes',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'active-zone-minutes', display: 'Active zone minutes' },
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      valueQuantity: ghQuantity(toNumber(data.activeZoneMinutes), UCUM.MINUTE),
      components: [
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'heart-rate-zone', display: 'Heart rate zone' },
          data.heartRateZone
        )
      ]
    },
    meta
  );
}

export function mapActivityLevelToFHIR(data: health_v4.Schema$ActivityLevel, meta: DataPointMeta): Observation {
  const period = intervalToPeriod(data.interval);

  // The record's whole payload is "this interval was spent at this activity level", so
  // the level is the value, not a component beside an empty one.
  return createGoogleObservation(
    {
      measure: 'activity-level',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'activity-level', display: 'Activity level' },
      effectivePeriod: period,
      expectsValue: true,
      valueCodeableConcept: data.activityLevelType
        ? codeableConcept({
            system: SYSTEMS.GOOGLE_HEALTH,
            code: data.activityLevelType,
            display: data.activityLevelType
          })
        : undefined,
      components: [
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'duration', display: 'Duration at this activity level' },
          periodMinutes(period),
          UCUM.MINUTE
        )
      ]
    },
    meta
  );
}

export function mapAltitudeToFHIR(data: health_v4.Schema$Altitude, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'altitude',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'altitude', display: 'Altitude gain' },
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      // Google reports elevation gain in millimetres. `m` is the UCUM base unit and is
      // what provider-vitronic already emits, so the two connectors agree.
      valueQuantity: ghQuantity(millimetresToMetres(data.gainMillimeters), UCUM.METRE)
    },
    meta
  );
}

export function mapDistanceToFHIR(data: health_v4.Schema$Distance, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'distance',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'distance', display: 'Distance' },
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      // A 5 km run published as 5000000 mm is technically true and useless.
      valueQuantity: ghQuantity(millimetresToMetres(data.millimeters), UCUM.METRE)
    },
    meta
  );
}

export function mapFloorsToFHIR(data: health_v4.Schema$Floors, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'floors',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'floors', display: 'Floors climbed' },
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      valueQuantity: ghQuantity(toNumber(data.count), GH_UCUM.FLOORS)
    },
    meta
  );
}

export function mapSedentaryPeriodToFHIR(data: health_v4.Schema$SedentaryPeriod, meta: DataPointMeta): Observation {
  const period = intervalToPeriod(data.interval);

  // The record carries nothing but its own interval, so the duration derived from that
  // interval is the value. Emitting a coded, final Observation with neither a value nor
  // a reason is a bare assertion the receiver cannot act on.
  return createGoogleObservation(
    {
      measure: 'sedentary-period',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'sedentary-period', display: 'Sedentary period' },
      effectivePeriod: period,
      expectsValue: true,
      valueQuantity: ghQuantity(periodMinutes(period), UCUM.MINUTE)
    },
    meta
  );
}

export function mapStepsToFHIR(data: health_v4.Schema$Steps, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'steps',
      category: CATEGORY.ACTIVITY,
      // 55423-8 is the unspecified-time step count; the interval is carried by
      // effectivePeriod. 41950-7 would require a per-day denominator on the unit.
      code: { system: SYSTEMS.LOINC, code: '55423-8', display: 'Number of steps in unspecified time Pedometer' },
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      valueQuantity: loincQuantity('55423-8', toNumber(data.count))
    },
    meta
  );
}

export function mapSwimLengthsDataToFHIR(data: health_v4.Schema$SwimLengthsData, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'swim-lengths-data',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'swim-lengths-data', display: 'Swim lengths data' },
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      valueQuantity: ghQuantity(toNumber(data.strokeCount), GH_UCUM.STROKES),
      components: [
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'swim-stroke-type', display: 'Swim stroke type' },
          data.swimStrokeType
        )
      ]
    },
    meta
  );
}

export function mapTimeInHeartRateZoneToFHIR(
  data: health_v4.Schema$TimeInHeartRateZone,
  meta: DataPointMeta
): Observation {
  const period = intervalToPeriod(data.interval);

  return createGoogleObservation(
    {
      measure: 'time-in-heart-rate-zone',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'time-in-heart-rate-zone', display: 'Time in heart rate zone' },
      effectivePeriod: period,
      expectsValue: true,
      // The measure is a duration; the zone qualifies which duration it is.
      valueQuantity: ghQuantity(periodMinutes(period), UCUM.MINUTE),
      method: data.heartRateZoneType
        ? codeableConcept({
            system: SYSTEMS.GOOGLE_HEALTH,
            code: data.heartRateZoneType,
            display: data.heartRateZoneType
          })
        : undefined,
      components: [
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'heart-rate-zone-type', display: 'Heart rate zone type' },
          data.heartRateZoneType
        )
      ]
    },
    meta
  );
}
