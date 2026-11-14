/**
 * WHAT: Maps WHOOP cycle (strain) records into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { CATEGORY, createObservation, LOINC_CODINGS, quantity, UCUM } from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import type { WhoopCycle } from '../../api/schemas/cycle';
import { type WhoopMapperContext, whoopCoding, whoopIdentifier, whoopResourceId } from './shared';

export function mapWhoopCycleToFHIR(rows: WhoopCycle[], context: WhoopMapperContext): Observation[] {
  if (rows.length === 0) return [];

  const observations: Observation[] = [];

  for (const row of rows) {
    const score = row.score;
    if (!score) continue;

    const key = row.id ?? row.start ?? 'unknown';
    const effectiveDateTime = row.start ?? context.retrievedAt;

    if (score.strain !== undefined) {
      observations.push(
        createObservation({
          id: whoopResourceId(context, key, 'strain'),
          identifier: whoopIdentifier(key),
          code: whoopCoding('day-strain', 'WHOOP day strain'),
          category: CATEGORY.ACTIVITY,
          subject: context.subject,
          effectiveDateTime,
          valueQuantity: quantity(score.strain, UCUM.SCORE)
        })
      );
    }

    if (score.average_heart_rate !== undefined) {
      observations.push(
        createObservation({
          id: whoopResourceId(context, key, 'cycle-avg-hr'),
          identifier: whoopIdentifier(`${key}-avg-hr`),
          code: LOINC_CODINGS.HEART_RATE,
          category: CATEGORY.VITAL_SIGNS,
          subject: context.subject,
          effectiveDateTime,
          valueQuantity: quantity(score.average_heart_rate, UCUM.PER_MINUTE)
        })
      );
    }
  }

  return observations;
}
