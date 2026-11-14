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
import type { OuraResilienceResponseList } from '../../api/schemas/resilience';
import { type OuraMapperContext, ouraCoding, ouraIdentifier, ouraResourceId } from './shared';

export function mapOuraResilienceToFHIR(
  ouraData: OuraResilienceResponseList,
  context: OuraMapperContext
): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((resilience) =>
    createObservation({
      id: ouraResourceId(context, resilience.id, 'daily-resilience'),
      identifier: ouraIdentifier(resilience.id),
      code: ouraCoding('resilience-level', 'Oura Resilience Level'),
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      effectiveDateTime: resilience.day,
      // A five-term closed value set. Shipped as free text, a receiver cannot bind
      // it to anything; as a CodeableConcept it is machine-readable.
      valueCodeableConcept:
        resilience.level === undefined || resilience.level === null
          ? undefined
          : codeableConcept(ouraCoding(resilience.level), resilience.level),
      dataAbsentReason: dataAbsentReason(),
      components: [
        optionalNumericComponent(
          ouraCoding('sleep-recovery', 'Sleep Recovery'),
          resilience.contributors.sleep_recovery,
          UCUM.SCORE
        ),
        optionalNumericComponent(
          ouraCoding('daytime-recovery', 'Daytime Recovery'),
          resilience.contributors.daytime_recovery,
          UCUM.SCORE
        ),
        optionalNumericComponent(ouraCoding('stress', 'Stress'), resilience.contributors.stress, UCUM.SCORE)
      ]
    })
  );
}
