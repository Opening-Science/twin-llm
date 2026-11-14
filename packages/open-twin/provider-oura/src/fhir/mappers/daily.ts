/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import {
  CATEGORY,
  createObservation,
  dataAbsentReason,
  optionalNumericComponent,
  quantity,
  UCUM
} from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { OuraDailyActivityResponseList } from '../../api/schemas/daily';
import {
  LOINC,
  localNumericComponent,
  minutesFromSeconds,
  type OuraMapperContext,
  ouraCoding,
  ouraIdentifier,
  ouraResourceId
} from './shared';

/**
 * LOINC 41979-6 has TIME = 24H, so its example unit carries the per-day
 * denominator: `kcal/(24.h)`. A bare `kcal` under it is the same category of error
 * as sending a single workout's calories under a 24-hour code.
 */
const KCAL_PER_24H = { unit: 'kcal/24h', code: 'kcal/(24.h)' };

export function mapOuraDailyActivityToFHIR(
  dailyActivity: OuraDailyActivityResponseList,
  context: OuraMapperContext
): Observation[] {
  if (!dailyActivity?.data || dailyActivity.data.length === 0) return [];

  return dailyActivity.data.map((activity) => {
    const contributor = (code: string, display: string, value: number | undefined) =>
      optionalNumericComponent(ouraCoding(code, display), value, UCUM.SCORE);

    return createObservation({
      id: ouraResourceId(context, activity.id, 'daily-activity'),
      identifier: ouraIdentifier(activity.id),
      code: ouraCoding('activity-score', 'Oura Activity Score'),
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      // Oura's daily timestamp is the wearer's local midnight and carries their UTC
      // offset. `new Date(t).toISOString()` discarded that offset, moving every
      // daily summary east of UTC to the previous day (D7).
      effectiveDateTime: activity.timestamp,
      // Missing data is never zero: `score ?? 0` publishes the worst possible value
      // on an 0-100 scale, indistinguishable from a genuine zero.
      valueQuantity: quantity(activity.score, UCUM.SCORE),
      dataAbsentReason: dataAbsentReason(),
      components: [
        localNumericComponent(LOINC.CALORIES_BURNED_24H, activity.total_calories, KCAL_PER_24H),
        // TODO(clinical-review): LOINC has no 24-hour code for the *active* subset
        // of a day's calories. 41981-2 "Calories burned" is a point-in-time code
        // for one activity and 41979-6 is the whole-day total, which is already
        // emitted above; reusing either would make two measures indistinguishable.
        optionalNumericComponent(
          ouraCoding('active-calories', 'Active Calories'),
          activity.active_calories,
          UCUM.KILOCALORIE
        ),
        optionalNumericComponent(
          ouraCoding('target-calories', 'Target Calories'),
          activity.target_calories,
          UCUM.KILOCALORIE
        ),
        // 41950-7's TIME axis is 24H, so the unit must carry the per-day
        // denominator. A bare count under it understates the time window.
        optionalNumericComponent(LOINC.STEPS_24H, activity.steps, UCUM.STEPS_PER_DAY),

        contributor('meet-daily-targets', 'Meet Daily Targets', activity.contributors.meet_daily_targets),
        contributor('move-every-hour', 'Move Every Hour', activity.contributors.move_every_hour),
        contributor('recovery-time', 'Recovery Time', activity.contributors.recovery_time),
        contributor('stay-active', 'Stay Active', activity.contributors.stay_active),
        contributor('training-frequency', 'Training Frequency', activity.contributors.training_frequency),
        contributor('training-volume', 'Training Volume', activity.contributors.training_volume),

        optionalNumericComponent(ouraCoding('average-met', 'Average MET'), activity.average_met_minutes, UCUM.MET),
        // There is no UCUM code for MET-minutes. `{MET-min}` is an annotation
        // denoting the unity with a label; `min` — the previous code — is read by
        // a conformant parser as 300 minutes of activity, not 300 MET-minutes.
        optionalNumericComponent(
          ouraCoding('high-activity-met-minutes', 'High Activity MET Minutes'),
          activity.high_activity_met_minutes,
          UCUM.MET_MINUTES
        ),
        optionalNumericComponent(
          ouraCoding('medium-activity-met-minutes', 'Medium Activity MET Minutes'),
          activity.medium_activity_met_minutes,
          UCUM.MET_MINUTES
        ),
        optionalNumericComponent(
          ouraCoding('low-activity-met-minutes', 'Low Activity MET Minutes'),
          activity.low_activity_met_minutes,
          UCUM.MET_MINUTES
        ),
        optionalNumericComponent(
          ouraCoding('sedentary-met-minutes', 'Sedentary MET Minutes'),
          activity.sedentary_met_minutes,
          UCUM.MET_MINUTES
        ),

        // Oura reports these in seconds; D4 fixes durations at `min`.
        optionalNumericComponent(
          ouraCoding('high-activity-time', 'High Activity Time'),
          minutesFromSeconds(activity.high_activity_time),
          UCUM.MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('medium-activity-time', 'Medium Activity Time'),
          minutesFromSeconds(activity.medium_activity_time),
          UCUM.MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('low-activity-time', 'Low Activity Time'),
          minutesFromSeconds(activity.low_activity_time),
          UCUM.MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('sedentary-time', 'Sedentary Time'),
          minutesFromSeconds(activity.sedentary_time),
          UCUM.MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('resting-time', 'Resting Time'),
          minutesFromSeconds(activity.resting_time),
          UCUM.MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('non-wear-time', 'Non-wear Time'),
          minutesFromSeconds(activity.non_wear_time),
          UCUM.MINUTE
        ),

        optionalNumericComponent(
          ouraCoding('equivalent-walking-distance', 'Equivalent Walking Distance'),
          activity.equivalent_walking_distance,
          UCUM.METRE
        ),
        optionalNumericComponent(
          ouraCoding('meters-to-target', 'Meters to Target'),
          activity.meters_to_target,
          UCUM.METRE
        ),
        optionalNumericComponent(ouraCoding('target-meters', 'Target Meters'), activity.target_meters, UCUM.METRE),
        optionalNumericComponent(
          ouraCoding('inactivity-alerts', 'Inactivity Alerts'),
          activity.inactivity_alerts,
          UCUM.COUNT
        )
      ]
    });
  });
}
