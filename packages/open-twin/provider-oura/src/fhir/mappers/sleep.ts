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
  LOINC_CODINGS,
  optionalNumericComponent,
  quantity,
  UCUM
} from '@open-twin/fhir-core';
import type { Extension, Observation } from 'fhir/r4';
import type { OuraSleepList } from '../../api/schemas/sleep';
import {
  LOINC,
  minutesFromSeconds,
  type OuraMapperContext,
  ouraCoding,
  ouraExtensionUrl,
  ouraIdentifier,
  ouraResourceId
} from './shared';

export function mapOuraSleepToFHIR(ouraData: OuraSleepList, context: OuraMapperContext): Observation[] {
  // D6: an empty window is not an exception. Ten mappers threw here while two
  // returned [], so a caller could not tell "no data" from "library bug".
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((sleep) => {
    const extensions: Extension[] = [];
    const addExtension = (fragment: string, value: string | undefined | null) => {
      if (value !== undefined && value !== null) {
        extensions.push({ url: ouraExtensionUrl(fragment), valueString: value });
      }
    };

    addExtension('sleep-day', sleep.day);
    addExtension('sleep-phase-30-sec', sleep.sleep_phase_30_sec);
    addExtension('sleep-phase-5-min', sleep.sleep_phase_5_min);
    addExtension('app-sleep-phase-5-min', sleep.app_sleep_phase_5_min);
    // The ring id travels as an extension rather than as `Observation.device`
    // pointing at `Device/<ring_id>`, because no mapper in this package emits a
    // Device with that id. `ring_configuration` is the endpoint that carries the
    // hardware fields, and that is where the Device resource is built.
    addExtension('ring-id', sleep.ring_id);

    const observation = createObservation({
      id: ouraResourceId(context, sleep.id, 'sleep'),
      identifier: ouraIdentifier(sleep.id),
      code: ouraCoding('sleep-score', 'Oura Sleep Score'),
      codeText: sleep.type ?? undefined,
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      // Oura supplies the wearer's local UTC offset and it is passed through
      // unchanged, so a night beginning at 23:00 local does not move a day (D7).
      effectivePeriod: { start: sleep.bedtime_start, end: sleep.bedtime_end },
      valueQuantity: quantity(sleep.score, UCUM.SCORE),
      dataAbsentReason: dataAbsentReason(),
      method: sleep.sleep_algorithm_version ? { text: sleep.sleep_algorithm_version } : undefined,
      note: sleep.sleep_analysis_reason ?? undefined,
      components: [
        // Oura reports durations in seconds; these five LOINC codes are bound to
        // `min` in LOINC_UNITS, so the value is converted, not relabelled.
        optionalNumericComponent(LOINC.SLEEP_DURATION, minutesFromSeconds(sleep.total_sleep_duration), UCUM.MINUTE),
        optionalNumericComponent(LOINC.REM_SLEEP_DURATION, minutesFromSeconds(sleep.rem_sleep_duration), UCUM.MINUTE),
        optionalNumericComponent(LOINC.DEEP_SLEEP_DURATION, minutesFromSeconds(sleep.deep_sleep_duration), UCUM.MINUTE),
        optionalNumericComponent(
          LOINC.LIGHT_SLEEP_DURATION,
          minutesFromSeconds(sleep.light_sleep_duration),
          UCUM.MINUTE
        ),
        optionalNumericComponent(LOINC.SLEEP_LATENCY, minutesFromSeconds(sleep.latency), UCUM.MINUTE),
        // LOINC 103213-5 is a modelling anomaly: the component reads "Duration in
        // bed" while the property is NRat and the example unit is `/h`. `/h` is
        // dimensionally meaningless for a duration, so `min` is emitted pending a
        // term-change request to Regenstrief. Recorded in DECISIONS.md.
        optionalNumericComponent(LOINC_CODINGS.TIME_IN_BED, minutesFromSeconds(sleep.time_in_bed), UCUM.MINUTE),
        optionalNumericComponent(
          ouraCoding('awake-time', 'Time Awake During Sleep Period'),
          minutesFromSeconds(sleep.awake_time),
          UCUM.MINUTE
        ),
        // TODO(clinical-review): sleep efficiency has no concept in LOINC or in
        // SNOMED CT — verified twice, including an exhaustive expansion of the
        // eight descendants of SNOMED 363817001 |Sleep related observable|. The
        // code previously used, SNOMED 248263006, means "Duration of sleep", so a
        // 95% efficiency published as 95 units of sleep duration. The local code
        // is named after the IEEE 1752.1 measure `sleep_efficiency_percentage` so
        // a future standard mapping is mechanical. Needs sign-off.
        optionalNumericComponent(
          ouraCoding('sleep-efficiency-percentage', 'Sleep Efficiency'),
          sleep.efficiency,
          UCUM.PERCENT
        ),
        // LOINC 103222-6 "Heart rate.minimum" is the minimum over the observation
        // period, which is what Oura reports. 40443-4 "Heart rate --resting" was
        // used before: a different statistic from a different physiological state,
        // measured awake and at rest, and reliably several bpm higher.
        optionalNumericComponent(LOINC.HEART_RATE_MINIMUM, sleep.lowest_heart_rate, UCUM.PER_MINUTE),
        // A period mean is not an instantaneous beat. The second coding names the
        // statistic, because two distinct measures must never be distinguished
        // only by a free-text display on one shared code.
        optionalNumericComponent(
          [LOINC_CODINGS.HEART_RATE, ouraCoding('sleep-average-heart-rate', 'Average Heart Rate During Sleep')],
          sleep.average_heart_rate,
          UCUM.PER_MINUTE
        ),
        optionalNumericComponent(
          [LOINC.RESPIRATORY_RATE, ouraCoding('sleep-average-breath', 'Average Breathing Rate During Sleep')],
          sleep.average_breath,
          UCUM.PER_MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('sleep-average-hrv', 'Average Heart Rate Variability During Sleep'),
          sleep.average_hrv,
          UCUM.MILLISECOND
        ),
        optionalNumericComponent(
          ouraCoding('restless-periods', 'Restless Periods'),
          sleep.restless_periods,
          UCUM.COUNT
        ),
        optionalNumericComponent(
          ouraCoding('sleep-score-delta', 'Sleep Score Delta'),
          sleep.sleep_score_delta,
          UCUM.SCORE
        ),
        optionalNumericComponent(
          ouraCoding('readiness-score-delta', 'Readiness Score Delta'),
          sleep.readiness_score_delta,
          UCUM.SCORE
        ),
        // TODO(clinical-review): a deviation from a personal baseline has no LOINC
        // or SNOMED concept, and must not travel under 8310-5 "Body temperature" —
        // a receiver storing "body temperature = 0.2" reads a lethal value. UCUM
        // `Cel` is a point on an interval scale; a difference is `K` (UCUM §21-22).
        optionalNumericComponent(
          ouraCoding('temperature-deviation', 'Temperature Deviation'),
          sleep.temperature_deviation,
          UCUM.KELVIN
        ),
        optionalNumericComponent(
          ouraCoding('temperature-trend-deviation', 'Temperature Trend Deviation'),
          sleep.temperature_trend_deviation,
          UCUM.KELVIN
        )
      ]
    });

    if (extensions.length > 0) observation.extension = extensions;

    return observation;
  });
}
