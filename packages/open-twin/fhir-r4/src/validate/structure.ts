/**
 * WHAT: Validates or normalises foreign FHIR R4 Bundles structurally.
 * NOT:  Must not rewrite clinical codes or units to pass gates.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 FHIR R4 structure rules (local checks); CI also runs official validator on emitted exemplars.
 */
import { z } from 'zod';
import { type FhirIssue, issue } from '../issues';
import { R4_REQUIRED_ELEMENTS, R4_RESOURCE_TYPES } from './spec-tables.gen';
import { isObject, type JsonObject } from './walk';

/** FHIR `id` primitive: `[A-Za-z0-9\-\.]{1,64}`. */
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

/** Bundle.type is a required binding, so an unlisted value is an error, not a warning. */
export const BUNDLE_TYPES = new Set([
  'document',
  'message',
  'transaction',
  'transaction-response',
  'batch',
  'batch-response',
  'history',
  'searchset',
  'collection'
]);

/**
 * Only the envelope is parsed with zod. A full R4 schema would be StructureDefinition
 * work by another name, which is explicitly not this package's job — the HL7
 * validator does that, and doing it badly here would be worse than not doing it.
 *
 * zod's own messages are never surfaced: `invalid_type` interpolates the received
 * value, and this package sees other people's records.
 */
const RESOURCE_ENVELOPE = z.looseObject({ resourceType: z.string() });

const BUNDLE_ENVELOPE = z.looseObject({
  resourceType: z.literal('Bundle'),
  type: z.string(),
  entry: z.array(z.unknown()).optional()
});

export interface ParsedResource {
  resourceType: string;
  node: JsonObject;
}

/**
 * Parses the outermost envelope. Returns the issues that make further checking
 * pointless — there is no value in reporting a missing `Observation.status` on
 * something that is not a resource at all.
 */
export function parseEnvelope(input: unknown, path: string): { resource?: ParsedResource; issues: FhirIssue[] } {
  if (!isObject(input)) {
    return {
      issues: [
        issue(
          'fatal',
          'structure',
          'ot-not-an-object',
          path,
          'A FHIR resource must be a JSON object. Arrays, primitives and null are not resources.'
        )
      ]
    };
  }

  const parsed = RESOURCE_ENVELOPE.safeParse(input);
  if (!parsed.success) {
    return {
      issues: [
        issue(
          'fatal',
          'structure',
          'ot-missing-resource-type',
          `${path}.resourceType`,
          'Every FHIR resource must carry a `resourceType` string. Without it the content cannot be typed.'
        )
      ]
    };
  }

  const resourceType = parsed.data.resourceType;
  if (!R4_RESOURCE_TYPES.has(resourceType)) {
    return {
      issues: [
        issue(
          'fatal',
          'structure',
          'ot-unknown-resource-type',
          `${path}.resourceType`,
          'The declared `resourceType` is not a concrete resource type in FHIR R4.'
        )
      ]
    };
  }

  return { resource: { resourceType, node: input }, issues: [] };
}

/**
 * Base-specification required elements and the `id` primitive form.
 *
 * The required-element table is generated from `hl7.fhir.r4.core#4.0.1`, so it says
 * what the specification says rather than what someone remembered. It is
 * deliberately limited to top-level elements: nested cardinality, slicing and
 * profile constraints belong to the HL7 validator.
 */
export function checkResourceStructure(resource: ParsedResource, path: string): FhirIssue[] {
  const issues: FhirIssue[] = [];
  const { node, resourceType } = resource;

  const id = node.id;
  if (id !== undefined && (typeof id !== 'string' || !FHIR_ID.test(id))) {
    issues.push(
      issue(
        'error',
        'value',
        'ot-invalid-id',
        `${path}.id`,
        'Resource.id must be a string of 1-64 characters drawn from A-Z, a-z, 0-9, hyphen and dot.'
      )
    );
  }

  // The resource type is deliberately absent from the message. It is one of a closed
  // set of 145 FHIR names rather than a measurement, but "this bundle contains a
  // MedicationStatement" is still a clinical statement about a person, and a
  // validation report is the artefact that ends up in a log. The expression locates
  // the element for anyone holding the bundle, which is the whole contract.
  for (const element of R4_REQUIRED_ELEMENTS[resourceType] ?? []) {
    if (isElementPresent(node, element)) continue;
    issues.push(
      issue(
        'error',
        'required',
        'ot-missing-required-element',
        `${path}.${element}`,
        'The base FHIR R4 definition of this resource type declares this element with a minimum cardinality of 1.'
      )
    );
  }

  return issues;
}

/** A `foo[x]` element is satisfied by any one of its typed spellings, e.g. `effectiveDateTime`. */
function isElementPresent(node: JsonObject, element: string): boolean {
  if (!element.endsWith('[x]')) return node[element] !== undefined;
  const prefix = element.slice(0, -3);
  return Object.keys(node).some((key) => key.length > prefix.length && key.startsWith(prefix));
}

export interface ParsedBundle {
  node: JsonObject;
  type: string;
  entries: unknown[];
}

export function parseBundle(input: JsonObject, path: string): { bundle?: ParsedBundle; issues: FhirIssue[] } {
  const parsed = BUNDLE_ENVELOPE.safeParse(input);
  if (!parsed.success) {
    // `Bundle.type` is the only element the envelope requires beyond resourceType,
    // and `checkResourceStructure` has already reported it if it is missing.
    return { issues: [] };
  }

  const issues: FhirIssue[] = [];
  if (!BUNDLE_TYPES.has(parsed.data.type)) {
    issues.push(
      issue(
        'error',
        'code-invalid',
        'ot-invalid-bundle-type',
        `${path}.type`,
        'Bundle.type is bound to the BundleType value set with a required strength; the supplied code is not in it.'
      )
    );
  }

  return { bundle: { node: input, type: parsed.data.type, entries: parsed.data.entry ?? [] }, issues };
}
