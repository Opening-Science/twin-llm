/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { type CodingInput, deterministicId, SYSTEMS } from '@open-twin/fhir-core';
import type { Identifier, Reference } from 'fhir/r4';

export const CONNECTOR = { connector: 'whoop', version: '0.1.0' };

export function whoopCoding(code: string, display?: string): CodingInput {
  return display === undefined ? { system: SYSTEMS.WHOOP, code } : { system: SYSTEMS.WHOOP, code, display };
}

export interface WhoopMapperContext {
  subject: Reference;
  subjectKey: string;
  retrievedAt: string;
}

export function whoopResourceId(context: WhoopMapperContext, vendorId: string, kind: string): string {
  return deterministicId({
    connector: CONNECTOR.connector,
    subjectKey: context.subjectKey,
    recordId: vendorId,
    measure: kind
  });
}

export function whoopIdentifier(vendorId: string): Identifier[] {
  return [{ system: SYSTEMS.WHOOP_IDENTIFIER, value: vendorId }];
}
