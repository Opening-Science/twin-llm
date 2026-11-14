/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { CATEGORY, createObservation, dataAbsentReason, quantity, UCUM } from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { OuraVO2MaxResponseList } from '../../api/schemas/vo2max';
import { LOINC, type OuraMapperContext, ouraIdentifier, ouraResourceId } from './shared';

export function mapOuraVO2MaxToFHIR(ouraData: OuraVO2MaxResponseList, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((vo2max) =>
    createObservation({
      id: ouraResourceId(context, vo2max.id, 'vo2-max'),
      identifier: ouraIdentifier(vo2max.id),
      // 94122-9 is weight-indexed VO2 (property VRatCnt, example unit
      // mL/min/kg{body_wt}), which is what a ring reports and what
      // provider-google-health already emits. 60842-2, used here before, is
      // *absolute* oxygen consumption with property VRat and example unit mL/min,
      // so the two connectors disagreed under one measurement.
      //
      // TODO(clinical-review): 94122-9 means "peak during exercise". A ring
      // estimate is a model output, not a measured peak from a graded exercise
      // test. It is still the least-wrong standard option, but Observation.method
      // should record that the value is device-estimated once a reviewer settles
      // the wording.
      code: LOINC.VO2_MAX,
      // Not `vital-signs`: VO2max is not one of the FHIR vital signs, and that
      // category invites the ucum-vitals-common binding, which does not contain
      // mL/kg/min.
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      effectiveDateTime: vo2max.timestamp,
      valueQuantity: quantity(vo2max.vo2_max, UCUM.ML_PER_KG_PER_MIN),
      dataAbsentReason: dataAbsentReason()
    })
  );
}
