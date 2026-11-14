import { describe, expect, it } from 'vitest';
import {
  deterministicId,
  minimalPatient,
  OPEN_TWIN_NAMESPACE,
  patientUuid,
  subjectReference,
  uuidv5
} from '../identity';

describe('uuidv5', () => {
  it('matches the RFC 4122 test vector', () => {
    // Verified against an external authority rather than against our own output.
    expect(uuidv5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('derives the open-twin namespace from the DNS namespace', () => {
    expect(uuidv5('opentwin.ch', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(OPEN_TWIN_NAMESPACE);
  });

  it('sets version 5 and the RFC 4122 variant', () => {
    const id = uuidv5('anything');
    expect(id[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('rejects a namespace that is not a UUID', () => {
    expect(() => uuidv5('x', 'not-a-uuid')).toThrow(TypeError);
  });
});

describe('deterministicId', () => {
  const base = { connector: 'oura', subjectKey: 'user-1', recordId: 'rec-1' };

  it('is stable across calls, so re-syncing does not duplicate resources', () => {
    expect(deterministicId(base)).toBe(deterministicId(base));
  });

  it('separates measures derived from one record', () => {
    // Three Observations previously shared one identifier array, so a server doing
    // conditional create collapsed weight, height and sex into a single resource.
    const weight = deterministicId({ ...base, measure: 'weight' });
    const height = deterministicId({ ...base, measure: 'height' });
    expect(weight).not.toBe(height);
  });

  it('separates connectors and subjects', () => {
    expect(deterministicId(base)).not.toBe(deterministicId({ ...base, connector: 'vitronic' }));
    expect(deterministicId(base)).not.toBe(deterministicId({ ...base, subjectKey: 'user-2' }));
  });
});

describe('subjectReference', () => {
  it('prefers a caller-supplied reference', () => {
    // The connector does not know who the patient is; an integrator that does
    // should be able to say so.
    const reference = { reference: 'Patient/real-one' };
    expect(subjectReference({ reference, connector: 'oura', subjectKey: 'u1' })).toBe(reference);
  });

  it('falls back to a stable urn:uuid, never Patient/example', () => {
    const result = subjectReference({ connector: 'oura', subjectKey: 'u1' });
    expect(result.reference).toBe(`urn:uuid:${patientUuid('oura', 'u1')}`);
    expect(result.reference).not.toContain('example');
    expect(result.reference).not.toContain('unknown');
  });

  it('gives one subject one reference across every mapper', () => {
    // The defect: a single Oura bundle carried four subject conventions at once.
    const a = subjectReference({ connector: 'oura', subjectKey: 'u1' });
    const b = subjectReference({ connector: 'oura', subjectKey: 'u1' });
    expect(a.reference).toBe(b.reference);
  });
});

describe('minimalPatient', () => {
  const patient = minimalPatient({
    connector: 'oura',
    subjectKey: 'sandbox-subject',
    identifierSystem: 'http://opentwin.ch/fhir/sid/oura'
  });

  it('answers the reference subjectReference mints for the same subject', () => {
    // The defect this exists for: with no vendor demographics, every Observation
    // carried a urn:uuid subject and no Patient was in the bundle to resolve it. The
    // HL7 validator reported "URN reference is not locally contained" for all 73.
    const reference = subjectReference({ connector: 'oura', subjectKey: 'sandbox-subject' }).reference;
    expect(reference).toBe(`urn:uuid:${patient.id}`);
  });

  it('asserts an identifier and nothing more', () => {
    // Name, birth date and gender are clinical facts. Inventing them to satisfy a
    // reference would be worse than the dangling reference it fixes.
    expect(Object.keys(patient).sort()).toEqual(['id', 'identifier', 'resourceType']);
    expect(patient.identifier).toEqual([{ system: 'http://opentwin.ch/fhir/sid/oura', value: 'sandbox-subject' }]);
  });

  it('is stable, so re-syncing resolves rather than duplicating', () => {
    const again = minimalPatient({
      connector: 'oura',
      subjectKey: 'sandbox-subject',
      identifierSystem: 'http://opentwin.ch/fhir/sid/oura'
    });
    expect(again.id).toBe(patient.id);
  });

  it('separates subjects, and separates connectors for one subject', () => {
    const other = minimalPatient({ connector: 'oura', subjectKey: 'other', identifierSystem: 'x' });
    const otherConnector = minimalPatient({
      connector: 'vitronic',
      subjectKey: 'sandbox-subject',
      identifierSystem: 'x'
    });
    expect(other.id).not.toBe(patient.id);
    expect(otherConnector.id).not.toBe(patient.id);
  });
});
