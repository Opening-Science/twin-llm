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
import type { Observation, Period } from 'fhir/r4';
import type { health_v4 } from 'googleapis';
import {
  applyOffset,
  bundleReference,
  createGoogleObservation,
  type DataPointMeta,
  GH_UCUM,
  ghOptionalNumericComponent,
  ghQuantity,
  intervalToPeriod,
  loincComponent,
  millimetresToMetres,
  periodMinutes,
  toNumber
} from './shared';

/**
 * Intake and sleep have no code in the HL7 `observation-category` value set — it runs
 * social-history, vital-signs, imaging, laboratory, procedure, survey, exam, therapy,
 * activity and nothing else. Rather than invent a code in HL7's namespace, these are
 * published under the Foundation's own.
 *
 * TODO(clinical-review): confirm these vendor categories, or agree a mapping onto an
 * existing HL7 category, before the implementation guide publishes.
 */
const NUTRITION_CATEGORY = { system: SYSTEMS.GOOGLE_HEALTH, code: 'nutrition', display: 'Nutrition' };
const SLEEP_CATEGORY = { system: SYSTEMS.GOOGLE_HEALTH, code: 'sleep', display: 'Sleep' };

export function mapElectrocardiogramToFHIR(data: health_v4.Schema$Electrocardiogram, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'electrocardiogram',
      category: CATEGORY.VITAL_SIGNS,
      // TODO(clinical-review): LOINC 11524-6 "EKG study" has SCALE = Doc — it is a
      // *document* code and belongs on a DiagnosticReport, not on an Observation
      // carrying numbers. A vendor-local code stands until a reviewer either supplies a
      // quantitative ECG code or the connector emits a DiagnosticReport.
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'electrocardiogram', display: 'Electrocardiogram' },
      effectivePeriod: intervalToPeriod(data.interval),
      components: [
        // TODO(clinical-review): this is a mean over the recording, not an instantaneous
        // rate, so bare LOINC 8867-4 would overstate it. 55425-3 ("Heart rate
        // unspecified time mean") is the candidate but its METHOD axis is Pedometer.
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'average-heart-rate', display: 'Average heart rate' },
          toNumber(data.beatsPerMinuteAvg),
          UCUM.PER_MINUTE
        ),
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'result-classification', display: 'ECG result classification' },
          data.resultClassification
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'sampling-frequency-hertz', display: 'Sampling frequency' },
          toNumber(data.samplingFrequencyHertz),
          GH_UCUM.HERTZ
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'lead-number', display: 'Number of leads' },
          toNumber(data.leadNumber),
          GH_UCUM.LEADS
        )
      ],
      device: data.medicalDeviceInfo?.deviceModel ? { display: data.medicalDeviceInfo.deviceModel } : undefined
    },
    meta
  );
}

export function mapExerciseToFHIR(data: health_v4.Schema$Exercise, meta: DataPointMeta): Observation {
  const summary = data.metricsSummary;

  return createGoogleObservation(
    {
      measure: 'exercise',
      category: CATEGORY.ACTIVITY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'exercise', display: 'Exercise' },
      // The vendor's own label for the session belongs in `code.text`, not in the
      // display of a code whose meaning is fixed.
      codeText: data.displayName ?? undefined,
      effectivePeriod: intervalToPeriod(data.interval),
      components: [
        stringComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'exercise-type', display: 'Exercise type' },
          data.exerciseType
        ),
        loincComponent('41981-2', 'Calories burned', toNumber(summary?.caloriesKcal)),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'distance', display: 'Distance' },
          millimetresToMetres(summary?.distanceMillimeters),
          UCUM.METRE
        ),
        loincComponent('55423-8', 'Number of steps in unspecified time Pedometer', toNumber(summary?.steps)),
        // TODO(clinical-review): a session mean, not an instantaneous heart rate. See
        // the note on the ECG mapper — 55425-3 is the candidate standard code.
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'average-heart-rate', display: 'Average heart rate' },
          toNumber(summary?.averageHeartRateBeatsPerMinute),
          UCUM.PER_MINUTE
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'elevation-gain', display: 'Elevation gain' },
          millimetresToMetres(summary?.elevationGainMillimeters),
          UCUM.METRE
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'active-zone-minutes', display: 'Active zone minutes' },
          toNumber(summary?.activeZoneMinutes),
          UCUM.MINUTE
        )
      ],
      note: data.notes ?? undefined
    },
    meta
  );
}

export function mapHydrationLogToFHIR(data: health_v4.Schema$HydrationLog, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'hydration-log',
      vendorCategory: NUTRITION_CATEGORY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'hydration-log', display: 'Hydration log' },
      effectivePeriod: intervalToPeriod(data.interval),
      expectsValue: true,
      valueQuantity: ghQuantity(toNumber(data.amountConsumed?.milliliters), GH_UCUM.MILLILITRE)
    },
    meta
  );
}

export function mapIrregularRhythmNotificationToFHIR(
  data: health_v4.Schema$IrregularRhythmNotification,
  meta: DataPointMeta
): Observation {
  return createGoogleObservation(
    {
      measure: 'irregular-rhythm-notification',
      category: CATEGORY.VITAL_SIGNS,
      code: {
        system: SYSTEMS.GOOGLE_HEALTH,
        code: 'irregular-rhythm-notification',
        display: 'Irregular rhythm notification'
      },
      effectivePeriod: intervalToPeriod(data.interval),
      components: [
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'alert-window-count', display: 'Alert window count' },
          data.alertWindows?.length,
          GH_UCUM.WINDOWS
        )
      ],
      device: data.medicalDeviceInfo?.deviceModel ? { display: data.medicalDeviceInfo.deviceModel } : undefined
    },
    meta
  );
}

export function mapNutritionLogToFHIR(data: health_v4.Schema$NutritionLog, meta: DataPointMeta): Observation {
  return createGoogleObservation(
    {
      measure: 'nutrition-log',
      vendorCategory: NUTRITION_CATEGORY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'nutrition-log', display: 'Nutrition log' },
      codeText: data.foodDisplayName ?? undefined,
      effectivePeriod: intervalToPeriod(data.interval),
      components: [
        stringComponent({ system: SYSTEMS.GOOGLE_HEALTH, code: 'meal-type', display: 'Meal type' }, data.mealType),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'energy', display: 'Energy intake' },
          toNumber(data.energy?.kcal),
          UCUM.KILOCALORIE
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'energy-from-fat', display: 'Energy from fat' },
          toNumber(data.energyFromFat?.kcal),
          UCUM.KILOCALORIE
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'total-carbohydrate', display: 'Total carbohydrate' },
          toNumber(data.totalCarbohydrate?.grams),
          UCUM.GRAM
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'total-fat', display: 'Total fat' },
          toNumber(data.totalFat?.grams),
          UCUM.GRAM
        )
      ]
    },
    meta
  );
}

function segmentPeriod(segment: {
  startTime?: string | null;
  startUtcOffset?: string | null;
  endTime?: string | null;
  endUtcOffset?: string | null;
}): Period | undefined {
  const start = applyOffset(segment.startTime, segment.startUtcOffset);
  const end = applyOffset(segment.endTime, segment.endUtcOffset);
  if (!start && !end) return undefined;
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}

/**
 * A sleep record's substance is the hypnogram, and the four aggregate minute counts
 * cannot be reconstructed back into it. Each stage segment and each out-of-bed segment
 * therefore becomes its own Observation, linked from the session by `hasMember`, so
 * nothing is lost on the way out.
 */
export function mapSleepToFHIR(data: health_v4.Schema$Sleep, meta: DataPointMeta): Observation[] {
  const summary = data.summary;
  const period = intervalToPeriod(data.interval);

  const children: Observation[] = [
    ...(data.stages ?? []).map((stage, index) =>
      createGoogleObservation(
        {
          measure: `sleep-stage-${index}`,
          vendorCategory: SLEEP_CATEGORY,
          code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'sleep-stage', display: 'Sleep stage' },
          effectivePeriod: segmentPeriod(stage),
          expectsValue: true,
          valueCodeableConcept: stage.type
            ? codeableConcept({ system: SYSTEMS.GOOGLE_HEALTH, code: stage.type, display: stage.type })
            : undefined,
          components: [
            ghOptionalNumericComponent(
              { system: SYSTEMS.GOOGLE_HEALTH, code: 'duration', display: 'Stage duration' },
              periodMinutes(segmentPeriod(stage)),
              UCUM.MINUTE
            )
          ]
        },
        meta
      )
    ),
    ...(data.outOfBedSegments ?? []).map((segment, index) =>
      createGoogleObservation(
        {
          measure: `out-of-bed-segment-${index}`,
          vendorCategory: SLEEP_CATEGORY,
          code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'out-of-bed-segment', display: 'Out of bed segment' },
          effectivePeriod: segmentPeriod(segment),
          expectsValue: true,
          valueQuantity: ghQuantity(periodMinutes(segmentPeriod(segment)), UCUM.MINUTE)
        },
        meta
      )
    )
  ];

  const stageSummaries = compact(
    (summary?.stagesSummary ?? []).map((stage) =>
      stage.type
        ? ghOptionalNumericComponent(
            {
              system: SYSTEMS.GOOGLE_HEALTH,
              code: `stage-minutes-${stage.type.toLowerCase()}`,
              display: `Minutes in ${stage.type}`
            },
            toNumber(stage.minutes),
            UCUM.MINUTE
          )
        : undefined
    )
  );

  const session = createGoogleObservation(
    {
      measure: 'sleep',
      vendorCategory: SLEEP_CATEGORY,
      code: { system: SYSTEMS.GOOGLE_HEALTH, code: 'sleep', display: 'Sleep session' },
      effectivePeriod: period,
      components: [
        loincComponent('93832-4', 'Sleep duration', toNumber(summary?.minutesAsleep)),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'minutes-awake', display: 'Minutes awake' },
          toNumber(summary?.minutesAwake),
          UCUM.MINUTE
        ),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'minutes-after-wake-up', display: 'Minutes after wake up' },
          toNumber(summary?.minutesAfterWakeUp),
          UCUM.MINUTE
        ),
        // LOINC 103213-5 "Duration in bed" is a modelling anomaly: the component says
        // duration, the property is NRat and the example unit is `/h`. `min` is emitted
        // pending a term-change request to Regenstrief. See DECISIONS.md.
        loincComponent(
          LOINC_CODINGS.TIME_IN_BED.code,
          LOINC_CODINGS.TIME_IN_BED.display,
          toNumber(summary?.minutesInSleepPeriod)
        ),
        loincComponent('103212-7', 'Duration of falling asleep', toNumber(summary?.minutesToFallAsleep)),
        ...stageSummaries,
        stringComponent({ system: SYSTEMS.GOOGLE_HEALTH, code: 'sleep-type', display: 'Sleep type' }, data.type),
        ghOptionalNumericComponent(
          { system: SYSTEMS.GOOGLE_HEALTH, code: 'out-of-bed-segment-count', display: 'Out of bed segment count' },
          data.outOfBedSegments?.length,
          GH_UCUM.SEGMENTS
        )
      ],
      identifier: data.metadata?.externalId
        ? [{ system: SYSTEMS.GOOGLE_HEALTH_IDENTIFIER, value: data.metadata.externalId }]
        : undefined,
      hasMember: children.map((child) => bundleReference(child.id as string))
    },
    meta
  );

  return [session, ...children];
}
