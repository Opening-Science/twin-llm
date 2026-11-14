/**
 * WHAT: Validates or normalises foreign FHIR R4 Bundles structurally.
 * NOT:  Must not rewrite clinical codes or units to pass gates.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 FHIR R4 structure rules (local checks); CI also runs official validator on emitted exemplars.
 */
import {
  buildBundle,
  type ConnectorVersion,
  connectorMeta,
  deterministicId,
  patientUuid,
  subjectReference
} from '@open-twin/fhir-core';
import type { Bundle, FhirResource, Meta, OperationOutcome, Patient, Reference } from 'fhir/r4';
import { type FhirIssue, type FhirIssueRule, issue, toOutcome } from '../issues';
import { readEntries } from '../validate/fullurl';
import { parseBundle, parseEnvelope } from '../validate/structure';
import { validateFhir } from '../validate/validate';
import { isObject, type JsonObject } from '../validate/walk';

const RESTFUL_TAIL = /\/([A-Za-z]+\/[A-Za-z0-9\-.]{1,64})$/;

/**
 * Findings that must not stop normalisation.
 *
 * Two different reasons, and they should not be confused:
 *
 *  - The addressing rules (`ot-fullurl-*`, `bdl-8`) are what normalisation exists to
 *    repair. Refusing to normalise a bundle because its fullUrls are wrong would be
 *    refusing to do the job.
 *  - The unit-policy rules are the opposite case: they are *not* repaired, because
 *    repairing them would mean rewriting a number or a code, and this function does
 *    not do that under any circumstances. They are carried through to the caller
 *    unchanged, attached to the normalised bundle, for a human to decide about.
 *
 * Everything else that is an error stops the process. Normalising a bundle that
 * violates obs-6, or silently discarding a dangling `urn:uuid:` finding, would
 * produce a tidy-looking bundle that is still wrong — and now with open-twin's
 * provenance tag on it, which makes it this project's problem rather than the
 * sender's.
 */
const NOT_A_BLOCKER: ReadonlySet<FhirIssueRule> = new Set<FhirIssueRule>([
  'ot-fullurl-missing',
  'ot-fullurl-relative',
  'ot-fullurl-uuid',
  'ot-fullurl-oid',
  'ot-fullurl-id-mismatch',
  'bdl-8',
  'ot-unit-policy',
  'ot-unit-dimension'
]);

/**
 * Findings that stop normalisation even though `validateFhir` rates them below
 * error.
 *
 * A dangling `urn:uuid:` reference is a warning in a conformance report, because
 * that is what the HL7 validator calls it and this package does not overrule the
 * validator on questions of FHIR conformance. Normalisation is a different question:
 * it reassigns every id and rewrites every reference to match, and a reference that
 * resolves to nothing cannot be rewritten. Continuing would emit a bundle whose
 * internal graph is broken, carrying open-twin's provenance tag.
 */
const BLOCKS_NORMALISATION_BY_DEFAULT: ReadonlySet<FhirIssueRule> = new Set<FhirIssueRule>([
  'ot-reference-unresolved-urn'
]);

export interface NormaliseOptions {
  /** Who is doing the ingesting, and at which version. Becomes the `meta.tag` (D3). */
  connector: ConnectorVersion;
  /**
   * A stable key for the person this bundle is about, in the sending system's own
   * terms. Used to derive deterministic ids (D2) and the `urn:uuid:` subject
   * fallback (D1). Never an email address or any other direct identifier.
   */
  subjectKey: string;
  /**
   * The subject every resource in the output will point at. Supply it when you know
   * who the patient is; when you do not, D1's `urn:uuid:` fallback is used and a
   * minimal Patient is added so the bundle still resolves internally.
   */
  subject?: Reference;
  /**
   * How to handle a `urn:` reference whose target is absent from the input Bundle.
   * The safe default is `reject`. `preserve` leaves the reference byte-for-byte
   * unchanged and keeps `ot-reference-unresolved-urn` in the typed result; it does
   * not mean the reference resolved.
   */
  unresolvedUrnPolicy?: 'reject' | 'preserve';
  /** ISO 8601. Supplied by the caller so the output is reproducible. */
  timestamp: string;
  /** Stable key so re-normalising the same input yields the same Bundle.id. */
  bundleKey: string;
  type?: 'collection' | 'transaction';
}

export interface NormaliseResult {
  /** Absent when the input could not be normalised. Never a partially rewritten bundle. */
  bundle?: Bundle;
  issues: FhirIssue[];
  outcome: OperationOutcome;
}

/**
 * Brings a foreign R4 Bundle into open-twin's conventions.
 *
 * Four things change and nothing else:
 *   D1  every `subject` is repointed at one caller-supplied reference
 *   D2  every resource gets a deterministic UUID id, and every entry a matching
 *       `urn:uuid:` fullUrl, so re-ingesting the same input is idempotent
 *   D3  every resource carries the connector provenance tag
 *   --  `text` narrative is removed, because it is a rendering of the resource
 *       *before* those three changes and is therefore stale by construction
 *
 * No value, no code, no unit and no timestamp is touched. That is the whole
 * discipline of this function: a normaliser that quietly corrects a unit is
 * indistinguishable, downstream, from one that quietly corrupts one.
 */
export function normaliseBundle(input: unknown, options: NormaliseOptions): NormaliseResult {
  const issues: FhirIssue[] = [];

  const validation = validateFhir(input);
  issues.push(...validation.issues);

  const preserveUnresolvedUrns = options.unresolvedUrnPolicy === 'preserve';
  const blocking = validation.issues.filter(
    (item) =>
      ((item.severity === 'error' || item.severity === 'fatal') && !NOT_A_BLOCKER.has(item.rule)) ||
      (!preserveUnresolvedUrns && BLOCKS_NORMALISATION_BY_DEFAULT.has(item.rule))
  );
  if (blocking.length > 0) return { issues, outcome: toOutcome(issues) };

  const envelope = parseEnvelope(input, 'Resource');
  if (envelope.resource?.resourceType !== 'Bundle') {
    issues.push(
      issue(
        'error',
        'structure',
        'ot-unknown-resource-type',
        'Resource.resourceType',
        'normaliseBundle expects a Bundle. Wrap a single resource in one before normalising it.'
      )
    );
    return { issues, outcome: toOutcome(issues) };
  }

  const parsed = parseBundle(envelope.resource.node, 'Bundle');
  const views = readEntries(parsed.bundle?.entries ?? [], 'Bundle').views;

  const subject = subjectReference({
    reference: options.subject,
    connector: options.connector.connector,
    subjectKey: options.subjectKey
  });

  // Pass 1: decide every new id before rewriting anything, so a reference can be
  // repointed regardless of the order entries appear in.
  const referenceIndex = emptyReferenceIndex();
  const assigned: Array<{ view: (typeof views)[number]; id: string }> = [];

  for (const view of views) {
    if (!view.resource || !view.resourceType) continue;
    const sourceKey = view.fullUrl ?? addressOf(view.resourceType, view.resource) ?? `entry-${view.index}`;
    const id = deterministicId({
      connector: options.connector.connector,
      subjectKey: options.subjectKey,
      recordId: sourceKey,
      measure: view.resourceType
    });
    assigned.push({ view, id });
    indexResource(referenceIndex, view.fullUrl, view.resourceType, view.resource, id);
  }

  // Pass 2: rewrite.
  const resources: FhirResource[] = [];
  const referenced = new Set<string>();

  for (const { view, id } of assigned) {
    const source = structuredClone(view.resource) as JsonObject;
    // Rebuilt without `text` rather than deleting the key, so the result is a plain
    // object with no holes and the narrative never survives by accident.
    const clone: JsonObject = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'text'));
    clone.id = id;

    issues.push(...rewriteReferences(clone, referenceIndex, view.fullUrl, referenced, `${view.path}.resource`));

    if (isObject(clone.subject)) {
      clone.subject = { ...subject };
      issues.push(
        issue(
          'information',
          'informational',
          'ot-normalised-subject',
          `${view.path}.resource.subject`,
          'Decision D1: the subject reference was repointed at the caller-supplied subject.'
        )
      );
    } else if (SUBJECT_EXPECTED.has(view.resourceType ?? '')) {
      issues.push(
        issue(
          'warning',
          'incomplete',
          'ot-normalised-subject-missing',
          `${view.path}.resource.subject`,
          'This resource carried no subject. One was not invented: the sender did not say who this is about, and normalisation does not get to decide.'
        )
      );
    }

    if (source.text !== undefined) {
      issues.push(
        issue(
          'information',
          'informational',
          'ot-normalised-narrative-dropped',
          `${view.path}.resource.text`,
          'The narrative was removed. It renders the resource as it was before its id, fullUrl and subject changed, and it commonly names the original subject in free text.'
        )
      );
    }

    clone.meta = mergeConnectorTag(clone.meta, options.connector);
    resources.push(clone as unknown as FhirResource);
  }

  // An ambiguous reference cannot safely be left as an apparent external reference:
  // after the ids are replaced there is no longer enough information to repair it.
  // Return no partially rewritten bundle.
  if (issues.some((item) => item.rule === 'ot-reference-ambiguous')) {
    return { issues, outcome: toOutcome(issues) };
  }

  issues.push(...ensureSubjectResolves(subject, options, resources));
  issues.push(...reportOrphanedPatients(assigned, referenced, subject));

  const bundle = buildBundle({
    connector: options.connector,
    resources,
    timestamp: options.timestamp,
    bundleKey: options.bundleKey,
    type: options.type
  });

  return { bundle, issues, outcome: toOutcome(issues) };
}

/** Resource types whose whole meaning depends on knowing who they are about. */
const SUBJECT_EXPECTED = new Set(['Observation', 'DiagnosticReport', 'Condition', 'Procedure', 'MedicationStatement']);

function addressOf(resourceType: string, resource: JsonObject): string | undefined {
  return typeof resource.id === 'string' ? `${resourceType}/${resource.id}` : undefined;
}

interface ReferenceIndex {
  /** Exact fullUrls, including absolute REST URLs and urns. */
  exact: Map<string, Set<string>>;
  /** Unqualified ResourceType/id aliases. May deliberately contain several targets. */
  address: Map<string, Set<string>>;
}

function emptyReferenceIndex(): ReferenceIndex {
  return { exact: new Map(), address: new Map() };
}

function addTarget(index: Map<string, Set<string>>, key: string, id: string): void {
  const targets = index.get(key) ?? new Set<string>();
  targets.add(id);
  index.set(key, targets);
}

function indexResource(
  index: ReferenceIndex,
  fullUrl: string | undefined,
  resourceType: string,
  resource: JsonObject,
  id: string
): void {
  if (fullUrl) addTarget(index.exact, fullUrl, id);
  const address = addressOf(resourceType, resource);
  if (address) addTarget(index.address, address, id);
}

function soleTarget(targets: ReadonlySet<string> | undefined): string | undefined {
  return targets?.size === 1 ? targets.values().next().value : undefined;
}

/**
 * Resolves a relative reference against the service base implied by the referring
 * entry's fullUrl. Two servers may legitimately use the same ResourceType/id; a
 * global tail map would silently attach the reference to whichever entry came last.
 */
function resolveTarget(
  reference: string,
  sourceFullUrl: string | undefined,
  index: ReferenceIndex
): { target?: string; ambiguous: boolean } {
  const exact = index.exact.get(reference);
  if (exact) return { target: soleTarget(exact), ambiguous: exact.size > 1 };

  if (RESTFUL_TAIL.test(reference)) return { ambiguous: false };
  if (!/^[A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$/.test(reference)) return { ambiguous: false };

  if (sourceFullUrl) {
    const sourceTail = RESTFUL_TAIL.exec(sourceFullUrl);
    if (sourceTail) {
      const base = sourceFullUrl.slice(0, sourceTail.index + 1);
      try {
        const resolved = new URL(reference, base).toString();
        const basedTargets = index.exact.get(resolved);
        if (basedTargets) return { target: soleTarget(basedTargets), ambiguous: basedTargets.size > 1 };
      } catch {
        // Validation owns malformed URLs. There is no safe base-aware rewrite here.
      }
    }
  }

  const unqualified = index.address.get(reference);
  return { target: soleTarget(unqualified), ambiguous: (unqualified?.size ?? 0) > 1 };
}

function rewriteReferences(
  node: unknown,
  index: ReferenceIndex,
  sourceFullUrl: string | undefined,
  referenced: Set<string>,
  path: string
): FhirIssue[] {
  const issues: FhirIssue[] = [];
  if (Array.isArray(node)) {
    for (const [itemIndex, item] of node.entries()) {
      issues.push(...rewriteReferences(item, index, sourceFullUrl, referenced, `${path}[${itemIndex}]`));
    }
    return issues;
  }
  if (!isObject(node)) return issues;

  if (typeof node.reference === 'string' && node.resourceType === undefined) {
    const resolution = resolveTarget(node.reference, sourceFullUrl, index);
    const target = resolution.target;
    if (target) {
      node.reference = `urn:uuid:${target}`;
      referenced.add(target);
    } else if (resolution.ambiguous) {
      issues.push(
        issue(
          'error',
          'multiple-matches',
          'ot-reference-ambiguous',
          `${path}.reference`,
          'This relative reference matches more than one resource in the bundle and has no usable entry base that identifies one target. Normalisation stopped rather than choosing by bundle order.'
        )
      );
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'reference') continue;
    issues.push(...rewriteReferences(value, index, sourceFullUrl, referenced, `${path}.${key}`));
  }
  return issues;
}

/**
 * Adds the connector tag without disturbing anything the sender put in `meta`.
 *
 * `meta.versionId` and `meta.lastUpdated` are left exactly as they arrived. They
 * describe the record on the sending system, which is a true statement about
 * provenance and is not this function's to edit.
 */
function mergeConnectorTag(existing: unknown, connector: ConnectorVersion): Meta {
  const tag = connectorMeta(connector).tag ?? [];
  if (!isObject(existing)) return { tag };
  const meta = structuredClone(existing) as Meta;
  const tags = meta.tag ?? [];
  const already = tags.some((item) => item.system === tag[0]?.system && item.code === tag[0]?.code);
  meta.tag = already ? tags : [...tags, ...tag];
  return meta;
}

/**
 * D1's fallback only keeps the bundle self-consistent if something in the bundle
 * actually carries the `urn:uuid:` the subject points at. When the caller supplied
 * their own reference this does nothing — they know who the patient is and where the
 * record lives, and inventing a Patient beside it would assert an identity twice.
 */
function ensureSubjectResolves(subject: Reference, options: NormaliseOptions, resources: FhirResource[]): FhirIssue[] {
  const reference = subject.reference;
  if (typeof reference !== 'string') return [];

  if (!reference.startsWith('urn:uuid:')) {
    return [
      issue(
        'information',
        'informational',
        'ot-normalised-subject-external',
        'Bundle.entry.resource.subject',
        'The caller-supplied subject points outside this bundle. Resolving it is the receiving system responsibility.'
      )
    ];
  }

  const carried = (target: string): boolean =>
    resources.some((resource) => resource.resourceType === 'Patient' && resource.id === target);

  const id = patientUuid(options.connector.connector, options.subjectKey);
  if (reference !== `urn:uuid:${id}`) {
    // A urn: the caller chose themselves. Nothing outside this bundle can resolve it,
    // so if no entry carries it the subject of every resource now points at nothing —
    // which is worse than the `Patient/example` this is meant to replace, because it
    // looks deliberate. Not repaired: inventing a Patient under an id the caller
    // picked would assert that it is theirs.
    return carried(reference.slice('urn:uuid:'.length))
      ? []
      : [
          issue(
            'warning',
            'not-found',
            'ot-normalised-subject-external',
            'Bundle.entry.resource.subject',
            'The caller-supplied subject is a urn: that no entry in this bundle carries, so it resolves nowhere. Supply a resolvable reference, or omit `subject` and let the D1 fallback add a Patient.'
          )
        ];
  }
  if (carried(id)) return [];

  // Deliberately empty of demographics. The connector does not know any, and a
  // Patient asserting nothing is honest where a Patient asserting a guess is not.
  const patient: Patient = { resourceType: 'Patient', id, meta: connectorMeta(options.connector) };
  resources.push(patient);
  return [];
}

function reportOrphanedPatients(
  assigned: ReadonlyArray<{ view: { path: string; resourceType?: string }; id: string }>,
  referenced: ReadonlySet<string>,
  subject: Reference
): FhirIssue[] {
  return assigned
    .filter(
      ({ view, id }) => view.resourceType === 'Patient' && !referenced.has(id) && subject.reference !== `urn:uuid:${id}`
    )
    .map(({ view }) =>
      issue(
        'warning',
        'business-rule',
        'ot-normalised-patient-orphaned',
        `${view.path}.resource`,
        'This Patient came with the bundle but nothing points at it any more, because every subject was repointed at the caller-supplied one. It was kept rather than dropped; deciding what it is for is the caller job.'
      )
    );
}
