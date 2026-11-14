/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { type CodingInput, codeableConcept, deterministicId, SYSTEMS } from '@open-twin/fhir-core';
import type { Identifier, Observation, Reference } from 'fhir/r4';

/** Identifies the connector and the release that produced a bundle (`connectorMeta`). */
export const CONNECTOR = { connector: 'oura', version: '0.1.0' };

/**
 * Extension canonicals are Foundation-controlled, and one per concept.
 *
 * Every extension in this package used to share a single url assembled from an
 * anchor in Oura's documentation page, so the four extensions on a workout —
 * source, intensity, day and label — were indistinguishable from one another. A
 * consumer could read the four strings and not know which was which.
 */
export function ouraExtensionUrl(fragment: string): string {
  return `http://opentwin.ch/fhir/StructureDefinition/oura-${fragment}`;
}

/** A concept Oura defines and no standard terminology does (D3). */
export function ouraCoding(code: string, display?: string): CodingInput {
  return display === undefined ? { system: SYSTEMS.OURA, code } : { system: SYSTEMS.OURA, code, display };
}

/**
 * LOINC codings, with LOINC's own Long Common Name as the display.
 *
 * `display` is omitted wherever the Long Common Name could not be read from a
 * primary source. The HL7 validator reports a display that does not belong to the
 * code as an **error** and an absent display as nothing at all, so omitting is
 * always safe and inventing one never is.
 */
export const LOINC = {
  SLEEP_DURATION: { system: SYSTEMS.LOINC, code: '93832-4', display: 'Sleep duration' },
  REM_SLEEP_DURATION: { system: SYSTEMS.LOINC, code: '93829-0', display: 'REM sleep duration' },
  DEEP_SLEEP_DURATION: { system: SYSTEMS.LOINC, code: '93831-6', display: 'Deep sleep duration' },
  LIGHT_SLEEP_DURATION: { system: SYSTEMS.LOINC, code: '93830-8', display: 'Light sleep duration' },
  SLEEP_LATENCY: { system: SYSTEMS.LOINC, code: '103212-7', display: 'Duration of falling asleep' },
  HEART_RATE_MINIMUM: { system: SYSTEMS.LOINC, code: '103222-6', display: 'Heart rate.minimum' },
  /** LOINC's component here is "Breaths" while its Long Common Name is "Respiratory rate". */
  RESPIRATORY_RATE: { system: SYSTEMS.LOINC, code: '9279-1' },
  BODY_HEIGHT: { system: SYSTEMS.LOINC, code: '8302-2', display: 'Body height' },
  BODY_WEIGHT: { system: SYSTEMS.LOINC, code: '29463-7', display: 'Body weight' },
  STEPS_24H: { system: SYSTEMS.LOINC, code: '41950-7', display: 'Number of steps in 24 hour Measured' },
  CALORIES_BURNED: { system: SYSTEMS.LOINC, code: '41981-2', display: 'Calories burned' },
  CALORIES_BURNED_24H: {
    system: SYSTEMS.LOINC,
    code: '41979-6',
    display: 'Calories burned in 24 hour Calculated'
  },
  VO2_MAX: {
    system: SYSTEMS.LOINC,
    code: '94122-9',
    display: 'Oxygen consumption (VO2)/Body weight [Volume Rate Content] --peak during exercise'
  },
  PULSE_WAVE_VELOCITY: { system: SYSTEMS.LOINC, code: '77196-4', display: 'Pulse wave velocity' }
} as const satisfies Record<string, CodingInput>;

/**
 * The subject every Observation points at, and the key its id is derived from.
 *
 * Both come from the caller rather than a default (D1). `Patient/example`,
 * `Patient/unknown` and `Patient/${person.id}` were all in use at once, and
 * `Patient/example` silently resolves on a receiving server to whichever example
 * patient happens to exist there.
 */
export interface OuraMapperContext {
  subject: Reference;
  /** Oura's own user id where available, otherwise a caller-supplied key. Never an email. */
  subjectKey: string;
  /**
   * When this data was retrieved, as an ISO instant.
   *
   * `personal_info` carries no timestamp of its own, but the R4 body-weight and
   * body-height profiles constrain `effective[x]` to 1..1 — the HL7 validator
   * reports its absence as an error, which is how this was found. The retrieval
   * time is the only honest thing available: it is not when the measurement was
   * taken, so the Observations that use it say so in a note rather than implying
   * a clinical measurement time the connector does not have.
   */
  retrievedAt: string;
}

/** Decision D2: an id that is a pure function of what the resource describes. */
export function ouraResourceId(context: OuraMapperContext, recordId: string, measure: string): string {
  return deterministicId({ connector: CONNECTOR.connector, subjectKey: context.subjectKey, recordId, measure });
}

export function ouraIdentifier(value: string): Identifier[] {
  return [{ system: SYSTEMS.OURA_IDENTIFIER, value }];
}

/**
 * UCUM pairs the shared table does not carry, because each is needed by exactly
 * one Oura measure and `LOINC_UNITS`/`UCUM` are cross-connector contracts.
 *
 * They are still real UCUM: `/h` is a rate, `kcal/(24.h)` is LOINC 41979-6's own
 * example unit for a 24-hour energy total, and `{ring_size}` is an annotation,
 * which UCUM §6■4 defines as the unity carrying a human-readable label.
 */
export const OURA_UNITS = {
  // `unit` is UCUM's own name for the code — see the note on the shared UCUM table.
  // What is being counted per hour belongs in the Observation's code, not its unit.
  PER_HOUR: { unit: 'per hour', code: '/h' },
  // UCUM annotations cannot contain a space, so the code stays a machine token while
  // the readable form names the sizing scale. A ring size means nothing without it.
  // Recorded as an exception in verify/units-allowlist.json.
  RING_SIZE: { unit: 'US ring size', code: '{ring_size}' }
} as const;

type LocalUnit = (typeof OURA_UNITS)[keyof typeof OURA_UNITS] | { unit: string; code: string };
type Component = NonNullable<Observation['component']>[number];

/** As `optionalNumericComponent`, for the pairs above. Omits absent values. */
export function localNumericComponent(
  coding: CodingInput | CodingInput[],
  value: number | null | undefined,
  unit: LocalUnit
): Component | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  return {
    code: codeableConcept(coding),
    valueQuantity: { value, unit: unit.unit, system: SYSTEMS.UCUM, code: unit.code }
  };
}

/**
 * Oura reports every duration in **seconds** — confirmed against the published
 * OpenAPI spec for `total_sleep_duration`, `deep_sleep_duration`,
 * `rem_sleep_duration`, `light_sleep_duration`, `time_in_bed`, `awake_time` and
 * `latency`. D4 fixes durations at UCUM `min`, so the value is converted rather
 * than relabelled: 27000 seconds is 450 minutes, not 27000 minutes.
 */
export function minutesFromSeconds(seconds: number | null | undefined): number | undefined {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return undefined;
  return Math.round((seconds / 60) * 100) / 100;
}
