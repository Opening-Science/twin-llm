/**
 * WHAT: Validates or normalises foreign FHIR R4 resources and Bundles structurally.
 * NOT:  Must not rewrite clinical codes or units to pass gates.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 FHIR R4 structure rules (local checks); CI also runs official validator on emitted exemplars.
 */
import type { OperationOutcome } from 'fhir/r4';
import { type FhirIssue, hasErrors, toOutcome } from '../issues';
import { checkUcumCodes, checkUnitPolicy } from '../units/check';
import { checkFullUrls, type EntryView, readEntries } from './fullurl';
import { checkObservation } from './invariants';
import { buildReferenceIndex, checkReferences, collectReferences, type ReferenceSite } from './references';
import { checkResourceStructure, parseBundle, parseEnvelope } from './structure';
import type { JsonObject } from './walk';

export interface ValidationOptions {
  /**
   * Check UCUM codes against the grammar and Observation units against the shared
   * `LOINC_UNITS` policy. Default true. Turning it off leaves a pure FHIR-structure
   * check, which is the right thing when the caller only wants to know whether the
   * payload is well-formed.
   */
  units?: boolean;
}

export interface ValidationResult {
  /** True when nothing of severity `error` or `fatal` was found. */
  ok: boolean;
  issues: FhirIssue[];
  /** The same findings as FHIR. Always populated, with one informational issue when clean. */
  outcome: OperationOutcome;
}

/**
 * Structural and conformance validation of an arbitrary FHIR R4 resource or Bundle.
 *
 * Never throws for bad input, no matter how bad — a caller that has to wrap this in
 * a try/catch cannot report anything useful, and a thrown string is not a report.
 * Everything comes back as issues, and as an `OperationOutcome` for the wire.
 *
 * What this does **not** do, on purpose: StructureDefinition-driven profile
 * validation, terminology-server lookups, and FHIR search. The first is the HL7
 * validator's job and a bad reimplementation is worse than none; the other two need
 * a server this package does not have.
 */
export function validateFhir(input: unknown, options: ValidationOptions = {}): ValidationResult {
  const checkUnits = options.units ?? true;
  const issues: FhirIssue[] = [];

  const envelope = parseEnvelope(input, 'Resource');
  issues.push(...envelope.issues);
  if (!envelope.resource) return result(issues);

  const root = envelope.resource.node;
  const rootPath = envelope.resource.resourceType;
  issues.push(...checkResourceStructure(envelope.resource, rootPath));

  if (envelope.resource.resourceType === 'Bundle') {
    issues.push(...validateBundle(root, rootPath, checkUnits));
  } else {
    issues.push(...validateResourceBody(root, envelope.resource.resourceType, rootPath, checkUnits));
    issues.push(...checkReferences(collectReferences(root, rootPath), { fullUrls: new Set(), relative: new Set() }));
  }

  return result(issues);
}

function validateBundle(root: JsonObject, path: string, checkUnits: boolean): FhirIssue[] {
  const issues: FhirIssue[] = [];

  const parsed = parseBundle(root, path);
  issues.push(...parsed.issues);
  if (!parsed.bundle) return issues;

  const entries = readEntries(parsed.bundle.entries, path);
  issues.push(...entries.issues);
  issues.push(...checkFullUrls(entries.views));

  const index = buildReferenceIndex(entries.views);
  const sites: ReferenceSite[] = [];

  for (const view of entries.views) {
    issues.push(...validateEntry(view, checkUnits));
    if (view.resource) sites.push(...collectReferences(view.resource, `${view.path}.resource`));
  }

  issues.push(...checkReferences(sites, index, parsed.bundle.type));
  return issues;
}

function validateEntry(view: EntryView, checkUnits: boolean): FhirIssue[] {
  if (!view.resource) return [];
  const path = `${view.path}.resource`;

  const envelope = parseEnvelope(view.resource, path);
  if (!envelope.resource) return envelope.issues;

  return [
    ...checkResourceStructure(envelope.resource, path),
    ...validateResourceBody(view.resource, envelope.resource.resourceType, path, checkUnits)
  ];
}

function validateResourceBody(
  resource: JsonObject,
  resourceType: string,
  path: string,
  checkUnits: boolean
): FhirIssue[] {
  const issues: FhirIssue[] = [];

  if (resourceType === 'Observation') {
    issues.push(...checkObservation(resource, path));
    if (checkUnits) issues.push(...checkUnitPolicy(resource, path));
  }
  if (checkUnits) issues.push(...checkUcumCodes(resource, path));

  return issues;
}

function result(issues: FhirIssue[]): ValidationResult {
  return { ok: !hasErrors(issues), issues, outcome: toOutcome(issues) };
}
