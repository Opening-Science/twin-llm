/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import {
  CATEGORY,
  codeableConcept,
  createObservation,
  dataAbsentReason,
  optionalNumericComponent,
  UCUM
} from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { OuraStressList } from '../../api/schemas/stress';
import { minutesFromSeconds, type OuraMapperContext, ouraCoding, ouraIdentifier, ouraResourceId } from './shared';

export function mapOuraStressToFHIR(ouraData: OuraStressList, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((stress) =>
    createObservation({
      id: ouraResourceId(context, stress.id, 'daily-stress'),
      identifier: ouraIdentifier(stress.id),
      code: ouraCoding('daily-stress', 'Oura Daily Stress'),
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      effectiveDateTime: stress.day,
      // `day_summary` is a closed value set of three terms. As a valueString no
      // receiver can bind it; as a CodeableConcept it is machine-readable.
      valueCodeableConcept:
        stress.day_summary === undefined || stress.day_summary === null
          ? undefined
          : codeableConcept(ouraCoding(stress.day_summary), stress.day_summary),
      dataAbsentReason: dataAbsentReason(),
      components: [
        optionalNumericComponent(
          ouraCoding('stress-high', 'Stress High Duration'),
          minutesFromSeconds(stress.stress_high),
          UCUM.MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('recovery-high', 'Recovery High Duration'),
          minutesFromSeconds(stress.recovery_high),
          UCUM.MINUTE
        )
      ]
    })
  );
}
