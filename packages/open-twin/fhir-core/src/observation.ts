/**
 * WHAT: Observation constructors including numericComponent with required unit and dataAbsentReason.
 * NOT:  Must not zero-fill missing values; must not attach canonical reference ranges to the Biomarker concept.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: HL7 FHIR R4 Observation / data-absent-reason; unit policy DECISIONS.md#d4.
 */
import type {
  CodeableConcept,
  Coding,
  Observation,
  ObservationReferenceRange,
  Period,
  Quantity,
  Reference
} from 'fhir/r4';
import { CATEGORY, SYSTEMS } from './systems';
import { quantity, type UcumUnit } from './units';

export interface CodingInput {
  system: string;
  code: string;
  display?: string;
}

export function toCoding(input: CodingInput): Coding {
  return { system: input.system, code: input.code, ...(input.display ? { display: input.display } : {}) };
}

/**
 * Accepts one coding or several. Several matter because two distinct measures must
 * never be distinguished only by a free-text `display` on an identical code — that
 * is not machine-readable and it is how `runVo2Max` and `vo2Max` became
 * indistinguishable under LOINC 94122-9.
 */
export function codeableConcept(input: CodingInput | CodingInput[], text?: string): CodeableConcept {
  const codings = Array.isArray(input) ? input : [input];
  return { coding: codings.map(toCoding), ...(text ? { text } : {}) };
}

/**
 * `unknown` is the correct data-absent-reason when the source simply did not supply
 * a value. Missing data is never zero: `score ?? 0` publishes the worst possible
 * value on an 0-100 scale, indistinguishable from a genuine zero.
 */
export function dataAbsentReason(code: 'unknown' | 'not-applicable' | 'error' = 'unknown'): CodeableConcept {
  const display = { unknown: 'Unknown', 'not-applicable': 'Not Applicable', error: 'Error' }[code];
  return { coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code, display }] };
}

export function compact<T>(items: (T | undefined)[]): T[] {
  return items.filter((item): item is T => item !== undefined);
}

type Component = NonNullable<Observation['component']>[number];

/**
 * A numeric component. The unit is **required** — that is the point.
 *
 * Making it optional is what allowed dimensionless Quantities to ship from three
 * different mappers; making it required turns the whole class from a review problem
 * into a compile error and enumerates every offender for free.
 *
 * A value that is absent, null, NaN or Infinity yields a component carrying
 * `dataAbsentReason` rather than a Quantity with a unit and no value (structurally
 * invalid FHIR) or the literal string "null".
 */
export function numericComponent(
  coding: CodingInput | CodingInput[],
  value: number | null | undefined,
  unit: UcumUnit
): Component {
  const q = quantity(value, unit);
  return q
    ? { code: codeableConcept(coding), valueQuantity: q }
    : { code: codeableConcept(coding), dataAbsentReason: dataAbsentReason() };
}

/** As `numericComponent`, but omits the component entirely when the value is absent. */
export function optionalNumericComponent(
  coding: CodingInput | CodingInput[],
  value: number | null | undefined,
  unit: UcumUnit
): Component | undefined {
  const q = quantity(value, unit);
  return q ? { code: codeableConcept(coding), valueQuantity: q } : undefined;
}

export function stringComponent(
  coding: CodingInput | CodingInput[],
  value: string | null | undefined
): Component | undefined {
  return value === undefined || value === null || value === ''
    ? undefined
    : { code: codeableConcept(coding), valueString: value };
}

/** Enum-valued fields belong in a CodeableConcept, not a free-text valueString. */
export function codeableComponent(
  coding: CodingInput | CodingInput[],
  value: CodingInput | undefined
): Component | undefined {
  return value ? { code: codeableConcept(coding), valueCodeableConcept: codeableConcept(value) } : undefined;
}

export interface CreateObservationInput {
  /** Stable, deterministic id. See `deterministicId` — required for idempotent re-sync. */
  id?: string;
  identifier?: Observation['identifier'];
  code: CodingInput | CodingInput[];
  codeText?: string;
  category?: { code: string; display: string } | Array<{ code: string; display: string }>;
  subject: Reference;
  /** At least one of these should be set. A measurement with no time cannot be ordered. */
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  valueQuantity?: Quantity;
  valueString?: string;
  valueBoolean?: boolean;
  valueCodeableConcept?: CodeableConcept;
  /** Set when no value resolved. Mutually exclusive with value[x] per FHIR obs-6. */
  dataAbsentReason?: CodeableConcept;
  components?: Array<Component | undefined>;
  /**
   * The interval(s) this result was measured against. Several may coexist and
   * contradict each other — a diagnostic cutoff and a population range answer
   * different questions. Absent means no interval arrived, which a consumer must
   * treat as grounds to abstain rather than as an interval of zero width.
   */
  referenceRange?: ObservationReferenceRange[];
  method?: CodeableConcept;
  device?: Reference;
  note?: string;
  profiles?: string[];
  meta?: Observation['meta'];
}

export function createObservation(input: CreateObservationInput): Observation {
  const observation: Observation = {
    resourceType: 'Observation',
    status: 'final',
    code: codeableConcept(input.code, input.codeText),
    subject: input.subject
  };

  if (input.id) observation.id = input.id;
  if (input.identifier?.length) observation.identifier = input.identifier;

  if (input.category) {
    const categories = Array.isArray(input.category) ? input.category : [input.category];
    observation.category = categories.map((c) => ({
      coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code: c.code, display: c.display }]
    }));
  }

  if (input.effectiveDateTime) observation.effectiveDateTime = input.effectiveDateTime;
  else if (input.effectivePeriod) observation.effectivePeriod = input.effectivePeriod;

  // FHIR obs-6: dataAbsentReason SHALL only be present if value[x] is not present.
  const hasValue =
    input.valueQuantity !== undefined ||
    input.valueString !== undefined ||
    input.valueBoolean !== undefined ||
    input.valueCodeableConcept !== undefined;

  if (input.valueQuantity) observation.valueQuantity = input.valueQuantity;
  if (input.valueString !== undefined) observation.valueString = input.valueString;
  if (input.valueBoolean !== undefined) observation.valueBoolean = input.valueBoolean;
  if (input.valueCodeableConcept) observation.valueCodeableConcept = input.valueCodeableConcept;
  if (!hasValue && input.dataAbsentReason) observation.dataAbsentReason = input.dataAbsentReason;

  const components = input.components ? compact(input.components) : [];
  if (components.length > 0) observation.component = components;

  // Only when the source supplied one. An absent interval is never synthesised.
  if (input.referenceRange?.length) observation.referenceRange = input.referenceRange;
  if (input.method) observation.method = input.method;
  if (input.device) observation.device = input.device;
  if (input.note) observation.note = [{ text: input.note }];

  const meta = { ...(input.meta ?? {}) };
  if (input.profiles?.length) meta.profile = [...(meta.profile ?? []), ...input.profiles];
  if (Object.keys(meta).length > 0) observation.meta = meta;

  return observation;
}

export { CATEGORY };
