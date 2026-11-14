/**
 * WHAT: Validates or normalises foreign FHIR R4 Bundles structurally.
 * NOT:  Must not rewrite clinical codes or units to pass gates.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 FHIR R4 structure rules (local checks); CI also runs official validator on emitted exemplars.
 */
import { type FhirIssue, issue } from '../issues';
import { isObject, type JsonObject } from './walk';

/**
 * A `urn:uuid:` fullUrl must carry a real, lowercase RFC 4122 UUID.
 *
 * This is the check that found the defect in `@open-twin/fhir-core`: the HL7
 * validator reports `urn:uuid:oura-activity-123` as an **error**, not a warning, and
 * every connector in this repository was emitting human-readable ids in that
 * position. The specification's own `uuid` primitive regex is lowercase-only, so an
 * uppercase UUID fails too — which is easy to produce, because most UUID libraries
 * will happily hand you one.
 */
const URN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** ISO/IEC 8824 object identifier, as FHIR's `oid` primitive constrains it. */
const URN_OID = /^[0-2](\.(0|[1-9][0-9]*))+$/;

const ABSOLUTE_URI = /^[a-z][a-z0-9+.-]*:/i;

/** `<base>/<ResourceType>/<id>`, the RESTful form a fullUrl may also take. */
const RESTFUL_URL = /\/([A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})$/;

export interface EntryView {
  index: number;
  node: JsonObject;
  fullUrl?: string;
  resource?: JsonObject;
  resourceType?: string;
  path: string;
}

/**
 * Reads the entries into a shape the later checks can use, reporting the entries
 * that are not usable at all.
 */
export function readEntries(entries: readonly unknown[], path: string): { views: EntryView[]; issues: FhirIssue[] } {
  const issues: FhirIssue[] = [];
  const views: EntryView[] = [];

  for (const [index, raw] of entries.entries()) {
    const entryPath = `${path}.entry[${index}]`;
    if (!isObject(raw)) {
      issues.push(issue('error', 'structure', 'ot-entry-not-an-object', entryPath, 'Bundle.entry must be an object.'));
      continue;
    }
    const resource = isObject(raw.resource) ? raw.resource : undefined;
    views.push({
      index,
      node: raw,
      fullUrl: typeof raw.fullUrl === 'string' ? raw.fullUrl : undefined,
      resource,
      resourceType: typeof resource?.resourceType === 'string' ? resource.resourceType : undefined,
      path: entryPath
    });
  }

  return { views, issues };
}

export function checkFullUrls(views: readonly EntryView[]): FhirIssue[] {
  const issues: FhirIssue[] = [];
  const seen = new Map<string, string[]>();

  for (const view of views) {
    const { node, path } = view;

    // bdl-5: an entry has to carry something. `request`/`response` cover the
    // transaction and history forms where a resource is legitimately absent.
    if (node.resource === undefined && node.request === undefined && node.response === undefined) {
      issues.push(
        issue(
          'error',
          'structure',
          'ot-entry-empty',
          path,
          'A Bundle entry must contain a resource unless it carries a request or a response.'
        )
      );
    }

    const raw = node.fullUrl;
    if (raw === undefined) {
      issues.push(
        issue(
          'warning',
          'incomplete',
          'ot-fullurl-missing',
          `${path}.fullUrl`,
          'Without a fullUrl this entry cannot be the target of a reference from anywhere else in the bundle.'
        )
      );
      continue;
    }

    if (typeof raw !== 'string' || !ABSOLUTE_URI.test(raw)) {
      issues.push(
        issue(
          'error',
          'value',
          'ot-fullurl-relative',
          `${path}.fullUrl`,
          'Bundle.entry.fullUrl must be an absolute URI. A relative URL has no meaning once the bundle is moved.'
        )
      );
      continue;
    }

    if (raw.includes('/_history/')) {
      issues.push(
        issue(
          'error',
          'value',
          'bdl-8',
          `${path}.fullUrl`,
          'FHIR invariant bdl-8: fullUrl cannot be a version specific reference.'
        )
      );
    }

    if (raw.startsWith('urn:uuid:')) {
      if (!URN_UUID.test(raw.slice('urn:uuid:'.length))) {
        issues.push(
          issue(
            'error',
            'value',
            'ot-fullurl-uuid',
            `${path}.fullUrl`,
            'A urn:uuid: fullUrl must be followed by a lowercase RFC 4122 UUID. The HL7 validator reports anything else here as an error, not a warning.'
          )
        );
      }
    } else if (raw.startsWith('urn:oid:')) {
      if (!URN_OID.test(raw.slice('urn:oid:'.length))) {
        issues.push(
          issue(
            'error',
            'value',
            'ot-fullurl-oid',
            `${path}.fullUrl`,
            'A urn:oid: fullUrl must be followed by a valid ISO object identifier.'
          )
        );
      }
    } else {
      const match = RESTFUL_URL.exec(raw);
      if (match && view.resource) {
        const [, type, id] = match;
        if (type !== view.resourceType || (view.resource.id !== undefined && id !== view.resource.id)) {
          issues.push(
            issue(
              'error',
              'value',
              'ot-fullurl-id-mismatch',
              `${path}.fullUrl`,
              'A RESTful fullUrl must address the resource it carries: its type segment and id must match resourceType and Resource.id.'
            )
          );
        }
      }
    }

    const versionId = versionOf(view.resource);
    const previous = seen.get(raw);
    if (previous?.includes(versionId)) {
      issues.push(
        issue(
          'error',
          'business-rule',
          'bdl-7',
          `${path}.fullUrl`,
          'FHIR invariant bdl-7: fullUrl must be unique in a bundle, unless entries sharing it have different meta.versionId.'
        )
      );
    }
    seen.set(raw, [...(previous ?? []), versionId]);
  }

  return issues;
}

function versionOf(resource: JsonObject | undefined): string {
  const meta = resource?.meta;
  if (isObject(meta) && typeof meta.versionId === 'string') return meta.versionId;
  return '';
}
