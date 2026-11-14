/**
 * WHAT: Subject references, deterministic ids, and minimal Patient helpers.
 * NOT:  Must not invent clinical identity beyond vendor user ids; host supplies real Patient references when known.
GOVERNED BY: DECISIONS.md#d1
 * CORRECTNESS: HL7 validator requirement that Bundle.entry.fullUrl urn:uuid values are UUIDs.
 */
import { createHash } from 'node:crypto';
import type { Patient, Reference } from 'fhir/r4';

/**
 * UUIDv5 namespace for open-twin, derived as UUIDv5(DNS, 'opentwin.ch').
 * Deterministic, so it can be recomputed and audited rather than trusted.
 */
export const OPEN_TWIN_NAMESPACE = 'cd483717-65bb-5d76-a007-ddb564f6c2cb';

/** RFC 4122 §4.3 name-based UUID using SHA-1. Verified against the RFC test vectors. */
export function uuidv5(name: string, namespace: string = OPEN_TWIN_NAMESPACE): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (namespaceBytes.length !== 16) {
    throw new TypeError(`uuidv5: namespace must be a UUID, received "${namespace}"`);
  }
  const hash = createHash('sha1')
    .update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Decision D2: a resource's id is a pure function of what it describes, so
 * re-syncing the same window produces the same id instead of a duplicate resource.
 *
 * Before this, `Observation.id` was never set on any resource in any package, and
 * only two of roughly forty mappers set an identifier at all. Every re-sync created
 * duplicates, and neither delta sync nor deletion is implementable without a stable
 * id to address.
 */
export function deterministicId(parts: {
  connector: string;
  /** The vendor's own user identifier. Never an email address or any other PII. */
  subjectKey: string;
  /** The vendor's record id. */
  recordId: string;
  /** Disambiguates several resources derived from one record, e.g. 'weight'. */
  measure?: string;
}): string {
  const key = [parts.connector, parts.subjectKey, parts.recordId, parts.measure ?? ''].join('|');
  return uuidv5(key);
}

export interface SubjectOptions {
  /**
   * A caller-supplied reference. The connector genuinely does not know who the
   * patient is, so an integrator that does should be able to say so.
   */
  reference?: Reference;
  connector: string;
  /** The vendor's own user identifier, used to derive a stable urn:uuid fallback. */
  subjectKey: string;
}

/**
 * Decision D1: one subject convention.
 *
 * Before this the repository used four at once — `Patient/${person.id}`,
 * `Patient/example` (in ten Oura mappers plus all of Google Health and VITRONIC),
 * `Patient/unknown`, and `Scan/${scan_id}` where `Scan` is not a FHIR resource type
 * at all. A single bundle for a single person therefore pointed at several
 * non-existent patients, and on ingestion everything became silently attributable
 * to whatever `Patient/example` happened to exist on the receiving server.
 */
export function subjectReference(options: SubjectOptions): Reference {
  if (options.reference) return options.reference;
  return { reference: `urn:uuid:${patientUuid(options.connector, options.subjectKey)}` };
}

export function patientUuid(connector: string, subjectKey: string): string {
  return uuidv5(`patient|${connector}|${subjectKey}`);
}

/**
 * The Patient a minted `urn:uuid:` subject reference points at.
 *
 * `subjectReference` mints a reference from the subject key whenever the caller does
 * not supply one, and something in the bundle has to answer it. Without this, a sync
 * that carried no vendor demographics — the Oura sandbox 404s on `personal_info`, so
 * this is its ordinary path, not an edge case — produced a bundle in which every
 * Observation referenced a Patient that was not there. The HL7 validator says it 73
 * times over: "URN reference is not locally contained within the bundle".
 *
 * It carries an identifier and nothing else. That is deliberate: the resource asserts
 * only that these Observations are about the person the vendor calls `subjectKey`,
 * which is exactly what the reference already claimed. Name, birth date and gender
 * come from the vendor's own demographics when a connector has them, and inventing
 * them here would be asserting clinical facts to satisfy a reference.
 *
 * The id is deterministic, so re-syncing the same subject resolves to the same
 * Patient rather than accumulating duplicates on the receiving server.
 */
export function minimalPatient(options: { connector: string; subjectKey: string; identifierSystem: string }): Patient {
  return {
    resourceType: 'Patient',
    id: patientUuid(options.connector, options.subjectKey),
    identifier: [{ system: options.identifierSystem, value: options.subjectKey }]
  };
}
