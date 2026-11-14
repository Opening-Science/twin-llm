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
import type { OuraReadinessResponseList } from '../../api/schemas/readiness';
import { type OuraMapperContext, ouraCoding, ouraIdentifier, ouraResourceId } from './shared';

export function mapOuraReadinessToFHIR(ouraData: OuraReadinessResponseList, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((readiness) => {
    const contributor = (code: string, display: string, value: number | null | undefined) =>
      optionalNumericComponent(ouraCoding(code, display), value, UCUM.SCORE);

    return createObservation({
      id: ouraResourceId(context, readiness.id, 'daily-readiness'),
      identifier: ouraIdentifier(readiness.id),
      code: ouraCoding('readiness-score', 'Oura Readiness Score'),
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      // The offset Oura supplies is the wearer's own; discarding it shifted every
      // daily summary east of UTC to the previous day (D7).
      effectiveDateTime: readiness.timestamp,
      valueQuantity: quantity(readiness.score, UCUM.SCORE),
      dataAbsentReason: dataAbsentReason(),
      components: [
        contributor('activity-balance', 'Activity Balance', readiness.contributors.activity_balance),
        contributor('hrv-balance', 'HRV Balance', readiness.contributors.hrv_balance),
        contributor('previous-day-activity', 'Previous Day Activity', readiness.contributors.previous_day_activity),
        contributor('previous-night', 'Previous Night', readiness.contributors.previous_night),
        contributor('recovery-index', 'Recovery Index', readiness.contributors.recovery_index),
        contributor('resting-heart-rate', 'Resting Heart Rate', readiness.contributors.resting_heart_rate),
        contributor('sleep-balance', 'Sleep Balance', readiness.contributors.sleep_balance),
        contributor('sleep-regularity', 'Sleep Regularity', readiness.contributors.sleep_regularity),
        // A deviation from a personal baseline is a temperature *difference*. UCUM
        // `Cel` denotes a point on an interval scale and cannot take part in
        // algebraic operations (UCUM §21-22); a difference is `K`. The two are
        // numerically equal as intervals, so only the code changes.
        //
        // TODO(clinical-review): no LOINC or SNOMED concept exists for a
        // temperature deviation, and it must not travel under 8310-5 "Body
        // temperature" — a receiver storing "body temperature = 0.3" reads a
        // lethal value. The local code needs sign-off.
        optionalNumericComponent(
          ouraCoding('temperature-deviation', 'Temperature Deviation'),
          readiness.temperature_deviation,
          UCUM.KELVIN
        ),
        optionalNumericComponent(
          ouraCoding('temperature-trend-deviation', 'Temperature Trend Deviation'),
          readiness.temperature_trend_deviation,
          UCUM.KELVIN
        )
      ]
    });
  });
}
