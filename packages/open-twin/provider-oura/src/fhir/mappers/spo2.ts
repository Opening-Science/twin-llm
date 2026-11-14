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
  UCUM
} from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { OuraSpo2List } from '../../api/schemas/spo2';
import {
  localNumericComponent,
  OURA_UNITS,
  type OuraMapperContext,
  ouraCoding,
  ouraIdentifier,
  ouraResourceId
} from './shared';

// Preserve Oura's existing output: this connector historically omitted the
// optional LOINC display, while the shared registry carries the canonical display.
const OURA_OXYGEN_SATURATION = {
  system: LOINC_CODINGS.OXYGEN_SATURATION.system,
  code: LOINC_CODINGS.OXYGEN_SATURATION.code
} as const;

export function mapOuraSpo2ToFHIR(ouraData: OuraSpo2List, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((spo2) =>
    createObservation({
      id: ouraResourceId(context, spo2.id, 'daily-spo2'),
      identifier: ouraIdentifier(spo2.id),
      code: ouraCoding('spo2-daily-summary', 'Oura Daily SpO2 Summary'),
      category: CATEGORY.VITAL_SIGNS,
      subject: context.subject,
      effectiveDateTime: spo2.day,
      // The daily summary carries no value of its own; its measurements are
      // components. Saying so is better than an Observation with a vital-signs
      // category, no value and no reason for the absence.
      dataAbsentReason: dataAbsentReason('not-applicable'),
      components: [
        optionalNumericComponent(
          // TODO(clinical-review): 59408-5 is a point-in-time SpO2 by pulse
          // oximetry, and this is a nightly average. The second coding says so;
          // an effectivePeriod covering the night would say it better, but Oura
          // supplies only the civil day on this endpoint.
          [OURA_OXYGEN_SATURATION, ouraCoding('spo2-daily-average', 'Daily Average Oxygen Saturation')],
          spo2.spo2_percentage?.average,
          UCUM.PERCENT
        ),
        localNumericComponent(
          ouraCoding('breathing-disturbance-index', 'Breathing Disturbance Index'),
          spo2.breathing_disturbance_index,
          OURA_UNITS.PER_HOUR
        )
      ]
    })
  );
}
