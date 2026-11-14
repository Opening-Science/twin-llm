/**
 * WHAT: Orchestrates fetch/parse/map (or map-only) into a FHIR Bundle result.
 * NOT:  Must not swallow partial failures; issues go to OperationOutcome (ADR 0006).
GOVERNED BY: DECISIONS.md#d5; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator on emitted bundles in CI; terminology/unit gates on source codings.
 */
import { buildBundle, patientUuid, SYSTEMS, subjectReference } from '@open-twin/fhir-core';
import type { Bundle, FhirResource, Observation, Patient, Reference } from 'fhir/r4';
import type { health_v4 } from 'googleapis';
import { ALL_TYPES } from '../api/record_types';
import {
  mapDailyHeartRateVariabilityToFHIR,
  mapDailyHeartRateZonesToFHIR,
  mapDailyOxygenSaturationToFHIR,
  mapDailyRespiratoryRateToFHIR,
  mapDailyRestingHeartRateToFHIR,
  mapDailySleepTemperatureDerivationsToFHIR,
  mapDailyVo2MaxToFHIR
} from './mappers/daily';
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
} from './mappers/interval';
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
} from './mappers/sample';
import {
  mapElectrocardiogramToFHIR,
  mapExerciseToFHIR,
  mapHydrationLogToFHIR,
  mapIrregularRhythmNotificationToFHIR,
  mapNutritionLogToFHIR,
  mapSleepToFHIR
} from './mappers/session';
import { CONNECTOR, type DataPointMeta, type SubjectContext } from './mappers/shared';

/** Envelope keys that carry no measurement, so their absence from a mapper is not a gap. */
const ENVELOPE_KEYS = new Set(['name', 'dataSource']);

/** camelCase `DataPoint` keys for every type this connector declares it can request. */
const DECLARED_DATA_KEYS = new Set(ALL_TYPES.map((type) => type.replace(/-(.)/g, (_, c: string) => c.toUpperCase())));

export function mapDataPointToFHIR(
  dataPoint: health_v4.Schema$DataPoint,
  context: SubjectContext
): Observation[] | undefined {
  const meta: DataPointMeta = {
    ...context,
    name: dataPoint.name,
    dataSource: dataPoint.dataSource
  };

  if (dataPoint.dailyHeartRateVariability) {
    return [mapDailyHeartRateVariabilityToFHIR(dataPoint.dailyHeartRateVariability, meta)];
  }
  if (dataPoint.dailyHeartRateZones) {
    return [mapDailyHeartRateZonesToFHIR(dataPoint.dailyHeartRateZones, meta)];
  }
  if (dataPoint.dailyOxygenSaturation) {
    return [mapDailyOxygenSaturationToFHIR(dataPoint.dailyOxygenSaturation, meta)];
  }
  if (dataPoint.dailyRespiratoryRate) {
    return [mapDailyRespiratoryRateToFHIR(dataPoint.dailyRespiratoryRate, meta)];
  }
  if (dataPoint.dailyRestingHeartRate) {
    return [mapDailyRestingHeartRateToFHIR(dataPoint.dailyRestingHeartRate, meta)];
  }
  if (dataPoint.dailySleepTemperatureDerivations) {
    return [mapDailySleepTemperatureDerivationsToFHIR(dataPoint.dailySleepTemperatureDerivations, meta)];
  }
  if (dataPoint.dailyVo2Max) {
    return [mapDailyVo2MaxToFHIR(dataPoint.dailyVo2Max, meta)];
  }

  if (dataPoint.bloodGlucose) {
    return [mapBloodGlucoseToFHIR(dataPoint.bloodGlucose, meta)];
  }
  if (dataPoint.bodyFat) {
    return [mapBodyFatToFHIR(dataPoint.bodyFat, meta)];
  }
  if (dataPoint.coreBodyTemperature) {
    return [mapCoreBodyTemperatureToFHIR(dataPoint.coreBodyTemperature, meta)];
  }
  if (dataPoint.heartRate) {
    return [mapHeartRateToFHIR(dataPoint.heartRate, meta)];
  }
  if (dataPoint.heartRateVariability) {
    return [mapHeartRateVariabilityToFHIR(dataPoint.heartRateVariability, meta)];
  }
  if (dataPoint.height) {
    return [mapHeightToFHIR(dataPoint.height, meta)];
  }
  if (dataPoint.oxygenSaturation) {
    return [mapOxygenSaturationToFHIR(dataPoint.oxygenSaturation, meta)];
  }
  if (dataPoint.respiratoryRateSleepSummary) {
    return [mapRespiratoryRateSleepSummaryToFHIR(dataPoint.respiratoryRateSleepSummary, meta)];
  }
  if (dataPoint.runVo2Max) {
    return [mapRunVo2MaxToFHIR(dataPoint.runVo2Max, meta)];
  }
  if (dataPoint.vo2Max) {
    return [mapVo2MaxToFHIR(dataPoint.vo2Max, meta)];
  }
  if (dataPoint.weight) {
    return [mapWeightToFHIR(dataPoint.weight, meta)];
  }

  if (dataPoint.activeEnergyBurned) {
    return [mapActiveEnergyBurnedToFHIR(dataPoint.activeEnergyBurned, meta)];
  }
  if (dataPoint.basalEnergyBurned) {
    return [mapBasalEnergyBurnedToFHIR(dataPoint.basalEnergyBurned, meta)];
  }
  if (dataPoint.activeMinutes) {
    return [mapActiveMinutesToFHIR(dataPoint.activeMinutes, meta)];
  }
  if (dataPoint.activeZoneMinutes) {
    return [mapActiveZoneMinutesToFHIR(dataPoint.activeZoneMinutes, meta)];
  }
  if (dataPoint.activityLevel) {
    return [mapActivityLevelToFHIR(dataPoint.activityLevel, meta)];
  }
  if (dataPoint.altitude) {
    return [mapAltitudeToFHIR(dataPoint.altitude, meta)];
  }
  if (dataPoint.distance) {
    return [mapDistanceToFHIR(dataPoint.distance, meta)];
  }
  if (dataPoint.floors) {
    return [mapFloorsToFHIR(dataPoint.floors, meta)];
  }
  if (dataPoint.sedentaryPeriod) {
    return [mapSedentaryPeriodToFHIR(dataPoint.sedentaryPeriod, meta)];
  }
  if (dataPoint.steps) {
    return [mapStepsToFHIR(dataPoint.steps, meta)];
  }
  if (dataPoint.swimLengthsData) {
    return [mapSwimLengthsDataToFHIR(dataPoint.swimLengthsData, meta)];
  }
  if (dataPoint.timeInHeartRateZone) {
    return [mapTimeInHeartRateZoneToFHIR(dataPoint.timeInHeartRateZone, meta)];
  }

  if (dataPoint.electrocardiogram) {
    return [mapElectrocardiogramToFHIR(dataPoint.electrocardiogram, meta)];
  }
  if (dataPoint.exercise) {
    return [mapExerciseToFHIR(dataPoint.exercise, meta)];
  }
  if (dataPoint.hydrationLog) {
    return [mapHydrationLogToFHIR(dataPoint.hydrationLog, meta)];
  }
  if (dataPoint.irregularRhythmNotification) {
    return [mapIrregularRhythmNotificationToFHIR(dataPoint.irregularRhythmNotification, meta)];
  }
  if (dataPoint.nutritionLog) {
    return [mapNutritionLogToFHIR(dataPoint.nutritionLog, meta)];
  }
  if (dataPoint.sleep) {
    return mapSleepToFHIR(dataPoint.sleep, meta);
  }

  return undefined;
}

/**
 * Keys on an unmapped DataPoint that this connector *declares* it can request.
 *
 * A silent `return undefined` is only acceptable for a key no `*_TYPES` list mentions —
 * that is genuinely someone else's data type. A declared type arriving and being
 * dropped is a defect in this package, and it must be visible rather than looking
 * exactly like "the window was empty".
 */
function declaredButUnmapped(dataPoint: health_v4.Schema$DataPoint): string[] {
  return Object.keys(dataPoint).filter((key) => !ENVELOPE_KEYS.has(key) && DECLARED_DATA_KEYS.has(key));
}

export interface BuildBundleOptions {
  /** The vendor's own user identifier. Never an email address or any other PII. */
  subjectKey: string;
  /**
   * A caller-supplied subject. The connector genuinely does not know who the patient
   * is; an integrator that does should be able to say so, and then no Patient is
   * invented on their behalf.
   */
  subject?: Reference;
  /** ISO 8601. Supplied by the caller so a bundle is reproducible in a test. */
  timestamp?: string;
  /** Stable key so re-running the same sync yields the same Bundle.id. */
  bundleKey?: string;
  type?: 'collection' | 'transaction';
}

export interface BundleResult {
  bundle: Bundle;
  /** Declared data types that arrived and were dropped. Empty is the healthy case. */
  unmapped: string[];
}

export function buildBundleFromResponses(
  responses: health_v4.Schema$ListDataPointsResponse[],
  options: BuildBundleOptions
): BundleResult {
  const context: SubjectContext = {
    subject: subjectReference({
      reference: options.subject,
      connector: CONNECTOR.connector,
      subjectKey: options.subjectKey
    }),
    subjectKey: options.subjectKey
  };

  const observations: Observation[] = [];
  const unmapped = new Set<string>();

  for (const response of responses) {
    for (const dataPoint of response.dataPoints ?? []) {
      const mapped = mapDataPointToFHIR(dataPoint, context);
      if (mapped) {
        observations.push(...mapped);
        continue;
      }
      for (const key of declaredButUnmapped(dataPoint)) {
        unmapped.add(key);
      }
    }
  }

  // Decision D1: with no caller-supplied subject the bundle carries its own Patient,
  // built from the vendor's user id under a deterministic `urn:uuid:`, so
  // `subject.reference` resolves inside the bundle instead of pointing at whatever
  // `Patient/example` happens to exist on the receiving server.
  const resources: FhirResource[] = options.subject
    ? [...observations]
    : [defaultPatient(options.subjectKey), ...observations];

  return {
    bundle: buildBundle({
      connector: CONNECTOR,
      resources,
      timestamp: options.timestamp ?? new Date().toISOString(),
      bundleKey: options.bundleKey ?? `google-health|${options.subjectKey}`,
      type: options.type
    }),
    unmapped: [...unmapped]
  };
}

function defaultPatient(subjectKey: string): Patient {
  return {
    resourceType: 'Patient',
    id: patientUuid(CONNECTOR.connector, subjectKey),
    identifier: [{ system: SYSTEMS.GOOGLE_HEALTH_IDENTIFIER, value: subjectKey }]
  };
}
