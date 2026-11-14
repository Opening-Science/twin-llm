/**
 * WHAT: Builds FHIR Bundles with lowercase urn:uuid fullUrls and connector provenance tags.
 * NOT:  Must not perform clinical selection across sources; aggregate owns reconciliation.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator (CI fhir-validate over emitted bundles).
 */
import type { Bundle, BundleEntry, FhirResource, Meta } from 'fhir/r4';
import { uuidv5 } from './identity';

/**
 * Gap 1M: the emitted FHIR contract is versioned.
 *
 * Without this, once the VITRONIC radians fix lands no consumer can distinguish a
 * bundle produced before it from one produced after — both are plausible-looking
 * and structurally valid — so corrupted historical data can never be identified and
 * re-fetched. The tag is cheap; not having it is unrecoverable.
 */
export const CONNECTOR_TAG_SYSTEM = 'http://opentwin.ch/fhir/CodeSystem/connector';

export interface ConnectorVersion {
  /** e.g. 'oura', 'google-health', 'vitronic'. */
  connector: string;
  /** The connector package version, so output is traceable to a release. */
  version: string;
}

export function connectorMeta(connector: ConnectorVersion, profiles?: string[]): Meta {
  const meta: Meta = {
    tag: [{ system: CONNECTOR_TAG_SYSTEM, code: connector.connector, version: connector.version }]
  };
  if (profiles?.length) meta.profile = profiles;
  return meta;
}

export interface BuildBundleOptions {
  connector: ConnectorVersion;
  resources: FhirResource[];
  /** ISO 8601. Supplied by the caller so bundles are reproducible in tests. */
  timestamp: string;
  /** Stable key so re-running the same sync yields the same Bundle.id. */
  bundleKey: string;
  type?: 'collection' | 'transaction';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `urn:uuid:` fullUrls must carry a real, lowercase UUID — the HL7 validator
 * reports anything else as an error, not a warning. A human-readable id such as
 * `oura-activity-123` is therefore canonicalised to a deterministic UUID here, so
 * that `entry.fullUrl` and `resource.id` can never disagree.
 *
 * Callers using `deterministicId` already produce a UUID and pass through unchanged.
 */
function canonicalId(resource: FhirResource, bundleKey: string): string {
  if (resource.id && UUID.test(resource.id)) return resource.id;
  const seed = resource.id ?? JSON.stringify(resource);
  return uuidv5(`${bundleKey}|${resource.resourceType}|${seed}`);
}

/**
 * Every entry gets a `fullUrl`, so intra-bundle references actually resolve.
 * Without one, a reference to `urn:uuid:...` or `Patient/x` in a collection bundle
 * points at nothing the receiver can find inside the bundle.
 */
export function buildBundle(options: BuildBundleOptions): Bundle {
  const type = options.type ?? 'collection';
  const entries: BundleEntry[] = options.resources.map((resource) => {
    const id = canonicalId(resource, options.bundleKey);
    const entry: BundleEntry = {
      fullUrl: `urn:uuid:${id}`,
      resource: { ...resource, id }
    };
    if (type === 'transaction') {
      entry.request = { method: 'PUT', url: `${resource.resourceType}/${id}` };
    }
    return entry;
  });

  return {
    resourceType: 'Bundle',
    id: uuidv5(options.bundleKey),
    meta: connectorMeta(options.connector),
    type,
    timestamp: options.timestamp,
    entry: entries
  };
}
