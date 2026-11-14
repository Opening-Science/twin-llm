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
import type { OuraCardiovascularAgeList } from '../../api/schemas/cardiovascular';
import { LOINC, type OuraMapperContext, ouraCoding, ouraIdentifier, ouraResourceId } from './shared';

export function mapOuraCardiovascularAgeToFHIR(
  cardioAgeList: OuraCardiovascularAgeList,
  context: OuraMapperContext
): Observation[] {
  if (!cardioAgeList?.data || cardioAgeList.data.length === 0) return [];

  return cardioAgeList.data.map((cardioAge) =>
    createObservation({
      id: ouraResourceId(context, cardioAge.id, 'cardiovascular-age'),
      identifier: ouraIdentifier(cardioAge.id),
      // TODO(clinical-review): neither LOINC nor SNOMED CT has a concept for
      // vascular age — searched on both, plus the NLM LOINC index, with zero hits.
      // LOINC 77195-6, used here before, is the cardio-ankle vascular index: a
      // dimensionless ratio whose normal value is near 8 and where anything above
      // 9 indicates arteriosclerosis. A vascular_age of 45 published under it read
      // as CAVI 45. The local code needs sign-off.
      code: ouraCoding('vascular-age', 'Oura Vascular Age'),
      category: CATEGORY.EXAM,
      subject: context.subject,
      effectiveDateTime: cardioAge.day,
      valueQuantity: quantity(cardioAge.vascular_age, UCUM.YEAR),
      dataAbsentReason: dataAbsentReason(),
      components: [
        optionalNumericComponent(
          LOINC.PULSE_WAVE_VELOCITY,
          cardioAge.pulse_wave_velocity,
          // LOINC's example unit is cm/s; m/s is commensurable and is what Oura
          // documents this field as, so LOINC_UNITS binds 77196-4 to m/s.
          UCUM.METRE_PER_SECOND
        )
      ]
    })
  );
}
