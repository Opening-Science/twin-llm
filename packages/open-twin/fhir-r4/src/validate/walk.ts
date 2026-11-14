/**
 * WHAT: Validates or normalises foreign FHIR R4 Bundles structurally.
 * NOT:  Must not rewrite clinical codes or units to pass gates.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 FHIR R4 structure rules (local checks); CI also runs official validator on emitted exemplars.
 */
export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface Visited {
  node: JsonObject;
  /** FHIRPath-style location, e.g. `Bundle.entry[2].resource.component[0]`. */
  path: string;
}

/**
 * The shape of a FHIR element name. Anything else is elided from a path rather than
 * copied into one.
 *
 * `validateFhir` accepts `unknown`, so a key in the tree is only an element name by
 * convention — a system that indexes an object by a record number, a date or a name
 * produces keys that are data. A path built by concatenating them would carry that
 * data into the report, which is the one thing this package must never do. The
 * placeholder keeps the path traceable by position without repeating the key.
 */
const ELEMENT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Depth-first walk over every object in the tree, including the root.
 *
 * Arrays contribute an index to the path so a finding can be traced back to one
 * element rather than to "somewhere in a list", which is the difference between a
 * report a developer can act on and one they cannot.
 */
export function* walkObjects(root: unknown, path: string): Generator<Visited> {
  if (Array.isArray(root)) {
    for (const [index, item] of root.entries()) {
      yield* walkObjects(item, `${path}[${index}]`);
    }
    return;
  }
  if (!isObject(root)) return;
  yield { node: root, path };
  for (const [key, value] of Object.entries(root)) {
    yield* walkObjects(value, `${path}.${ELEMENT_NAME.test(key) ? key : '<redacted>'}`);
  }
}

/**
 * The `value[x]` element names FHIR R4 defines on Observation and on
 * Observation.component. Both share the same choice list, which is why obs-6 and
 * the component check can be expressed against one table.
 */
export const OBSERVATION_VALUE_ELEMENTS = [
  'valueQuantity',
  'valueCodeableConcept',
  'valueString',
  'valueBoolean',
  'valueInteger',
  'valueRange',
  'valueRatio',
  'valueSampledData',
  'valueTime',
  'valueDateTime',
  'valuePeriod'
] as const;

export function presentValueElements(node: JsonObject): string[] {
  return OBSERVATION_VALUE_ELEMENTS.filter((name) => node[name] !== undefined);
}
