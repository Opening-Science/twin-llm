/**
 * WHAT: Validates or normalises foreign FHIR R4 Bundles structurally.
 * NOT:  Must not rewrite clinical codes or units to pass gates.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 FHIR R4 structure rules (local checks); CI also runs official validator on emitted exemplars.
 */
import { type FhirIssue, issue } from '../issues';
import type { EntryView } from './fullurl';
import { isObject, type JsonObject, walkObjects } from './walk';

/** `Type/id`, optionally version-specific. The form a relative reference may take. */
const RELATIVE_REFERENCE = /^([A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/([A-Za-z0-9\-.]{1,64}))?$/;
const ABSOLUTE_URI = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `Type?query` — a conditional reference: a search URI standing in for a reference.
 *
 * The type segment is matched as loosely as `RELATIVE_REFERENCE` matches it, on
 * purpose. Checking one form against `R4_RESOURCE_TYPES` and not the other would be a
 * difference somebody has to explain later, and an unknown type is caught where all
 * unknown types are caught.
 *
 * The query must be non-empty. A bare `Type?` is a search with no parameters, which
 * cannot describe *which* resource is meant, and falls through to malformed.
 */
const CONDITIONAL_REFERENCE = /^[A-Za-z]+\?.+$/;

export interface ReferenceIndex {
  /** Every `entry.fullUrl` in the bundle. */
  fullUrls: Set<string>;
  /** Every `Type/id` a bundle entry can be addressed by. */
  relative: Set<string>;
}

/**
 * What a reference inside this bundle is allowed to resolve to.
 *
 * A `Type/id` key is registered both from `entry.resource.id` and from the tail of a
 * RESTful `fullUrl`, because a receiver will accept either and a validator that only
 * accepted one would manufacture failures.
 */
export function buildReferenceIndex(views: readonly EntryView[]): ReferenceIndex {
  const fullUrls = new Set<string>();
  const relative = new Set<string>();

  for (const view of views) {
    if (view.fullUrl) {
      fullUrls.add(view.fullUrl);
      const tail = /\/([A-Za-z]+\/[A-Za-z0-9\-.]{1,64})$/.exec(view.fullUrl);
      if (tail?.[1]) relative.add(tail[1]);
    }
    if (view.resourceType && typeof view.resource?.id === 'string') {
      relative.add(`${view.resourceType}/${view.resource.id}`);
    }
  }

  return { fullUrls, relative };
}

export interface ReferenceSite {
  value: string;
  /** FHIRPath of the `reference` element itself. */
  path: string;
  /** The resource the reference sits inside, for `#contained` resolution. */
  container: JsonObject;
}

export function collectReferences(root: JsonObject, path: string): ReferenceSite[] {
  const sites: ReferenceSite[] = [];
  for (const { node, path: nodePath } of walkObjects(root, path)) {
    if (typeof node.reference === 'string' && node.resourceType === undefined) {
      sites.push({ value: node.reference, path: `${nodePath}.reference`, container: root });
    }
  }
  return sites;
}

/**
 * Reference resolution *inside* a bundle.
 *
 * The severities differ by reference form, because the forms make different
 * promises. A `urn:uuid:` reference is only meaningful inside the bundle that
 * carries the matching `fullUrl` — nothing on the receiving server can resolve it —
 * so a dangling one is reported. A relative `Type/id` reference may legitimately
 * point at a resource the receiver already holds, so its absence from the bundle is
 * information, not a defect; reporting it as one would fail almost every real-world
 * collection bundle.
 *
 * The dangling URN is a **warning**, not an error, and that is not this package's
 * judgement: the HL7 reference validator reports exactly one line for it,
 * `Warning - URN reference is not locally contained within the bundle`, and where the
 * two disagree the validator is right. `normaliseBundle` treats the same finding as
 * blocking, because it rewrites the entire reference graph and cannot rewrite a
 * reference that points nowhere — a stricter local rule, applied where it belongs
 * and not smuggled into a conformance report.
 *
 * `bundleType` carries `Bundle.type` because one reference form is legal in exactly
 * one kind of bundle. R4 http.html, *Conditional References*: in a transaction, and
 * only in a transaction, a reference may be replaced by a search URI describing how
 * to find the target. The server executing the transaction runs the search and
 * substitutes the result; zero matches or more than one fails the transaction. So a
 * `Type?query` outside a transaction is genuinely malformed — there is nothing there
 * to execute it — and inside one it is conformant and unresolvable here, which is the
 * same shape as an external reference and gets the same severity.
 *
 * Omitting `bundleType` means "not inside a bundle at all", which is not a
 * transaction either — that is the standalone-resource call in `validate.ts`, the
 * one that also passes an empty index.
 */
export function checkReferences(
  sites: readonly ReferenceSite[],
  index: ReferenceIndex,
  bundleType?: string
): FhirIssue[] {
  const issues: FhirIssue[] = [];

  for (const site of sites) {
    const value = site.value;

    if (value.startsWith('#')) {
      const id = value.slice(1);
      const contained = Array.isArray(site.container.contained) ? site.container.contained : [];
      const found = contained.some((item) => isObject(item) && item.id === id);
      if (!found) {
        issues.push(
          issue(
            'error',
            'not-found',
            'ot-reference-unresolved-contained',
            site.path,
            'A fragment reference must name a resource in the `contained` array of the resource that carries it.'
          )
        );
      }
      continue;
    }

    if (value.startsWith('urn:')) {
      if (!index.fullUrls.has(value)) {
        issues.push(
          issue(
            'warning',
            'not-found',
            'ot-reference-unresolved-urn',
            site.path,
            'A urn: reference can only be resolved against an entry.fullUrl in the same bundle, and no entry carries it.'
          )
        );
      }
      continue;
    }

    if (RELATIVE_REFERENCE.test(value)) {
      if (!index.relative.has(stripVersion(value))) {
        issues.push(
          issue(
            'information',
            'informational',
            'ot-reference-external',
            site.path,
            'This relative reference does not resolve inside the bundle. It is only valid if the receiver already holds the target.'
          )
        );
      }
      continue;
    }

    if (CONDITIONAL_REFERENCE.test(value)) {
      if (bundleType !== 'transaction') {
        issues.push(
          issue(
            'error',
            'value',
            'ot-reference-malformed',
            site.path,
            'A search URI may stand in for a reference only inside a transaction bundle, where a server resolves it. Anywhere else nothing executes the search.'
          )
        );
        continue;
      }

      // Deliberately not resolved against the index. A conditional reference is a
      // FHIR search, and this package has no server and does no search; matching it
      // against the entries here would answer a different question and answer it
      // wrongly, because the target is normally a resource the receiver already holds.
      issues.push(
        issue(
          'information',
          'informational',
          'ot-reference-conditional',
          site.path,
          'This conditional reference is resolved by the server executing the transaction. The transaction fails unless the search matches exactly one resource.'
        )
      );
      continue;
    }

    if (ABSOLUTE_URI.test(value)) {
      const tail = /\/([A-Za-z]+\/[A-Za-z0-9\-.]{1,64})$/.exec(value)?.[1];
      if (!index.fullUrls.has(value) && !(tail && index.relative.has(tail))) {
        issues.push(
          issue(
            'information',
            'informational',
            'ot-reference-external',
            site.path,
            'This absolute reference points outside the bundle. Resolving it is the receiving system responsibility.'
          )
        );
      }
      continue;
    }

    issues.push(
      issue(
        'error',
        'value',
        'ot-reference-malformed',
        site.path,
        'Reference.reference must be a fragment (#id), a relative Type/id, an absolute URI, or — in a transaction — a conditional Type?query.'
      )
    );
  }

  return issues;
}

function stripVersion(value: string): string {
  const match = RELATIVE_REFERENCE.exec(value);
  return match ? `${match[1]}/${match[2]}` : value;
}
