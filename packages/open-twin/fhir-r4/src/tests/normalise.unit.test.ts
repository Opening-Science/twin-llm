import { CONNECTOR_TAG_SYSTEM, patientUuid } from '@open-twin/fhir-core';
import type { Bundle, Observation } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { normaliseBundle } from '../normalise/normalise';
import { HL7_LIPIDS_BUNDLE } from '../samples/hl7-lipids-bundle';
import { HL7_VITALS_BUNDLE } from '../samples/hl7-vitals-bundle';
import { validateFhir } from '../validate/validate';
import { INVALID_FIXTURES, VALID_BASELINE } from './fixtures/invalid-bundles';

const CONNECTOR = { connector: 'fhir-r4', version: '0.1.0' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const options = (overrides: Partial<Parameters<typeof normaliseBundle>[1]> = {}) => ({
  connector: CONNECTOR,
  subjectKey: 'test-subject',
  timestamp: '2026-07-26T10:00:00Z',
  bundleKey: 'test-bundle',
  ...overrides
});

function normalised(input: unknown = HL7_LIPIDS_BUNDLE, overrides = {}): Bundle {
  const result = normaliseBundle(input, options(overrides));
  if (!result.bundle) throw new Error(`normalisation refused: ${result.issues.map((i) => i.rule).join(', ')}`);
  return result.bundle;
}

const observations = (bundle: Bundle): Observation[] =>
  (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is Observation => resource?.resourceType === 'Observation');

describe('normaliseBundle', () => {
  describe('D2 — deterministic ids and well-formed fullUrls', () => {
    it('gives every entry a urn:uuid fullUrl carrying a real lowercase UUID', () => {
      for (const entry of normalised().entry ?? []) {
        expect(entry.fullUrl).toMatch(/^urn:uuid:/);
        expect(entry.fullUrl?.slice(9)).toMatch(UUID);
      }
    });

    it('keeps entry.fullUrl and resource.id in step', () => {
      for (const entry of normalised().entry ?? []) {
        expect(entry.fullUrl).toBe(`urn:uuid:${entry.resource?.id}`);
      }
    });

    it('is idempotent: the same input twice yields byte-identical output', () => {
      expect(JSON.stringify(normalised())).toEqual(JSON.stringify(normalised()));
    });

    it('derives different ids for different subjects, so two people never collide', () => {
      const a = normalised(HL7_LIPIDS_BUNDLE, { subjectKey: 'person-a' });
      const b = normalised(HL7_LIPIDS_BUNDLE, { subjectKey: 'person-b' });
      // Every id, pairwise, and not merely "the two lists differ". The synthesised
      // Patient varies with the subject key on its own, so comparing whole lists
      // passes even when every clinical resource in the two bundles shares an id —
      // which is the collision this test exists to rule out.
      const idsOf = (bundle: Bundle) => (bundle.entry ?? []).map((entry) => entry.resource?.id);
      const first = idsOf(a);
      const second = idsOf(b);

      expect(first).toHaveLength(6);
      expect(second).toHaveLength(6);
      for (const [index, id] of first.entries()) {
        expect(id, `entry ${index} collided across subjects`).not.toEqual(second[index]);
      }
    });
  });

  describe('D1 — one subject', () => {
    it('repoints every subject at the caller-supplied reference', () => {
      const subject = { reference: 'Patient/12345', display: 'supplied by the integrator' };
      const bundle = normalised(HL7_VITALS_BUNDLE, { subject });
      const subjects = observations(bundle).map((observation) => observation.subject?.reference);

      expect(subjects.length).toBeGreaterThan(0);
      expect(new Set(subjects)).toEqual(new Set(['Patient/12345']));
      // `Patient/example` is the exact anti-pattern D1 exists to end.
      expect(JSON.stringify(bundle)).not.toContain('Patient/example');
    });

    it('falls back to a urn:uuid subject and adds a Patient that carries it', () => {
      const bundle = normalised(HL7_VITALS_BUNDLE);
      const expected = patientUuid(CONNECTOR.connector, 'test-subject');
      const patients = (bundle.entry ?? []).filter((entry) => entry.resource?.resourceType === 'Patient');

      expect(patients).toHaveLength(1);
      expect(patients[0]?.resource?.id).toBe(expected);
      for (const observation of observations(bundle)) {
        expect(observation.subject?.reference).toBe(`urn:uuid:${expected}`);
      }
    });

    it('does not invent a subject for a resource that never had one', () => {
      const input = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.org/fhir/Observation/no-subject',
            resource: {
              resourceType: 'Observation',
              id: 'no-subject',
              status: 'final',
              code: { coding: [{ system: 'http://loinc.org', code: '93832-4' }] }
            }
          }
        ]
      };
      const result = normaliseBundle(input, options());
      const observation = observations(result.bundle as Bundle)[0];

      expect(observation?.subject).toBeUndefined();
      expect(result.issues.map((issue) => issue.rule)).toContain('ot-normalised-subject-missing');
    });

    it('warns when a Patient that came with the bundle is left unreferenced', () => {
      const result = normaliseBundle(HL7_LIPIDS_BUNDLE, options({ subject: { reference: 'Patient/12345' } }));
      // Bundle-lipids carries no Patient, so the negative case is asserted here and
      // the positive case below, on a bundle that does.
      expect(result.issues.map((issue) => issue.rule)).not.toContain('ot-normalised-patient-orphaned');

      const withPatient = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://example.org/fhir/Patient/pat2',
            resource: { resourceType: 'Patient', id: 'pat2', gender: 'female' }
          }
        ]
      };
      const orphaned = normaliseBundle(withPatient, options({ subject: { reference: 'Patient/12345' } }));
      expect(orphaned.issues.map((issue) => issue.rule)).toContain('ot-normalised-patient-orphaned');
    });

    it('warns when the caller supplies a urn subject that nothing in the bundle carries', () => {
      const subject = { reference: 'urn:uuid:3f1b8c40-5d21-4e77-9a03-1b2c3d4e5f60' };
      const result = normaliseBundle(HL7_VITALS_BUNDLE, options({ subject }));
      const warning = result.issues.find((issue) => issue.rule === 'ot-normalised-subject-external');

      // Every Observation now points at nothing at all, which looks more deliberate
      // than the Patient/example it replaced and is therefore more dangerous.
      expect(warning?.severity).toBe('warning');
      expect(result.bundle?.entry?.some((entry) => entry.resource?.resourceType === 'Patient')).toBe(false);
    });

    it('says only that an external subject is the receiver problem, and does not warn', () => {
      const result = normaliseBundle(HL7_VITALS_BUNDLE, options({ subject: { reference: 'Patient/12345' } }));
      const note = result.issues.find((issue) => issue.rule === 'ot-normalised-subject-external');
      expect(note?.severity).toBe('information');
    });
  });

  describe('D3 — connector provenance', () => {
    it('tags the bundle and every resource in it', () => {
      const bundle = normalised();
      const tagged = (meta: { tag?: Array<{ system?: string; code?: string; version?: string }> } | undefined) =>
        meta?.tag?.some(
          (tag) => tag.system === CONNECTOR_TAG_SYSTEM && tag.code === 'fhir-r4' && tag.version === '0.1.0'
        );

      expect(tagged(bundle.meta)).toBe(true);
      for (const entry of bundle.entry ?? []) expect(tagged(entry.resource?.meta)).toBe(true);
    });

    it('leaves a meta.profile the sender declared alone', () => {
      const bundle = normalised(HL7_VITALS_BUNDLE);
      for (const observation of observations(bundle)) {
        expect(observation.meta?.profile).toEqual(['http://hl7.org/fhir/StructureDefinition/vitalsigns']);
      }
    });

    it('does not add the tag twice when the same bundle is normalised again', () => {
      const once = normalised();
      const twice = normalised(once);
      for (const entry of twice.entry ?? []) {
        const tags = entry.resource?.meta?.tag?.filter((tag) => tag.system === CONNECTOR_TAG_SYSTEM) ?? [];
        expect(tags).toHaveLength(1);
      }
    });
  });

  describe('references', () => {
    it('rewrites an intra-bundle reference to the new urn:uuid of its target', () => {
      const bundle = normalised();
      const report = (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .find((resource) => resource?.resourceType === 'DiagnosticReport');
      const results = (report as { result?: Array<{ reference?: string }> } | undefined)?.result ?? [];
      const fullUrls = new Set((bundle.entry ?? []).map((entry) => entry.fullUrl));

      expect(results).toHaveLength(4);
      for (const result of results) {
        expect(result.reference).toMatch(/^urn:uuid:/);
        expect(fullUrls.has(result.reference)).toBe(true);
      }
    });

    it('leaves a reference that points outside the bundle exactly as it arrived', () => {
      const bundle = normalised();
      const performers = JSON.stringify(bundle);
      expect(performers).toContain('Organization/1832473e-2fe0-452d-abe9-3cdb9879522f');
    });

    it('resolves a relative reference against its own entry base when two servers reuse the same id', () => {
      const input = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://a.example/fhir/Patient/p',
            resource: { resourceType: 'Patient', id: 'p', gender: 'female' }
          },
          {
            fullUrl: 'https://a.example/fhir/Observation/o',
            resource: {
              resourceType: 'Observation',
              id: 'o',
              status: 'final',
              code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
              subject: { reference: 'Patient/external' },
              performer: [{ reference: 'Patient/p' }]
            }
          },
          {
            fullUrl: 'https://b.example/fhir/Patient/p',
            resource: { resourceType: 'Patient', id: 'p', gender: 'male' }
          }
        ]
      };

      const bundle = normalised(input, { subject: { reference: 'Patient/external' } });
      const entries = bundle.entry ?? [];
      const expected = entries.find((entry) => {
        const resource = entry.resource as { resourceType?: string; gender?: string } | undefined;
        return resource?.resourceType === 'Patient' && resource.gender === 'female';
      });
      const observation = entries.find((entry) => entry.resource?.resourceType === 'Observation')
        ?.resource as Observation;

      expect(observation.performer?.[0]?.reference).toBe(expected?.fullUrl);
    });

    it('refuses an unbased relative reference that matches resources on two servers', () => {
      const input = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'https://a.example/fhir/Patient/p',
            resource: { resourceType: 'Patient', id: 'p' }
          },
          {
            fullUrl: 'urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            resource: {
              resourceType: 'Observation',
              id: 'o',
              status: 'final',
              code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
              subject: { reference: 'Patient/external' },
              performer: [{ reference: 'Patient/p' }]
            }
          },
          {
            fullUrl: 'https://b.example/fhir/Patient/p',
            resource: { resourceType: 'Patient', id: 'p' }
          }
        ]
      };

      const result = normaliseBundle(input, options({ subject: { reference: 'Patient/external' } }));

      expect(result.bundle).toBeUndefined();
      expect(result.issues).toContainEqual(
        expect.objectContaining({ severity: 'error', rule: 'ot-reference-ambiguous' })
      );
    });

    it('produces a bundle whose own references all resolve', () => {
      const result = validateFhir(normalised());
      expect(result.issues.filter((issue) => issue.rule === 'ot-reference-unresolved-urn')).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });

  describe('what it must never do', () => {
    it('changes no value, code, unit or timestamp', () => {
      const before = observations(HL7_VITALS_BUNDLE);
      const after = observations(normalised(HL7_VITALS_BUNDLE));

      expect(before).toHaveLength(3);
      expect(after).toHaveLength(before.length);
      for (const [index, original] of before.entries()) {
        const result = after[index];
        expect(result?.code).toEqual(original.code);
        expect(result?.valueQuantity).toEqual(original.valueQuantity);
        expect(result?.effectiveDateTime).toEqual(original.effectiveDateTime);
        expect(result?.status).toEqual(original.status);
        expect(result?.category).toEqual(original.category);
        expect(result?.referenceRange).toEqual(original.referenceRange);
        expect(result?.interpretation).toEqual(original.interpretation);
      }
    });

    it('leaves a unit that violates D4 in place, and reports it', () => {
      const fixture = INVALID_FIXTURES.find((item) => item.name === 'unit-policy-height-in-inches');
      const result = normaliseBundle(fixture?.bundle, options());
      const observation = observations(result.bundle as Bundle)[0];

      expect(observation?.valueQuantity?.code).toBe('[in_i]');
      expect(observation?.valueQuantity?.value).toBe(66.89999999999999);
      expect(result.issues.map((issue) => issue.rule)).toContain('ot-unit-policy');
    });

    it('refuses a bundle that violates obs-6 rather than normalising round it', () => {
      const fixture = INVALID_FIXTURES.find((item) => item.name === 'obs-6-value-and-data-absent-reason');
      const result = normaliseBundle(fixture?.bundle, options());

      expect(result.bundle).toBeUndefined();
      expect(result.issues.map((issue) => issue.rule)).toContain('obs-6');
    });

    it('refuses a bundle with a reference that resolves to nothing', () => {
      const fixture = INVALID_FIXTURES.find((item) => item.name === 'dangling-urn-reference');
      const result = normaliseBundle(fixture?.bundle, options());

      // Only a warning in the conformance report, because that is what the HL7
      // validator calls it. Still fatal here, because every reference is rewritten.
      expect(result.bundle).toBeUndefined();
      expect(result.issues.map((issue) => issue.rule)).toContain('ot-reference-unresolved-urn');
    });

    it('preserves and reports an unresolved non-subject urn only when explicitly requested', () => {
      const input = structuredClone(VALID_BASELINE) as Bundle;
      const sourceObservation = observations(input)[0];
      const unresolvedEncounter = 'urn:uuid:3f1b8c40-5d21-4e77-9a03-1b2c3d4e5f60';
      if (!sourceObservation) throw new Error('VALID_BASELINE must contain an Observation');
      sourceObservation.encounter = { reference: unresolvedEncounter };

      const result = normaliseBundle(
        input,
        options({
          subject: { reference: 'Patient/external' },
          unresolvedUrnPolicy: 'preserve'
        })
      );
      const observation = observations(result.bundle as Bundle)[0];

      expect(result.bundle).toBeDefined();
      expect(observation?.code.coding?.[0]).toMatchObject({ code: '8867-4' });
      expect(observation?.valueQuantity).toMatchObject({ value: 62, unit: 'per minute', code: '/min' });
      expect(observation?.effectiveDateTime).toBe('2026-07-26T09:30:00+02:00');
      expect(observation?.encounter?.reference).toBe(unresolvedEncounter);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          rule: 'ot-reference-unresolved-urn',
          expression: 'Bundle.entry[1].resource.encounter.reference'
        })
      );
    });

    it('repairs the addressing problems it exists to repair rather than refusing them', () => {
      const fixture = INVALID_FIXTURES.find((item) => item.name === 'fullurl-not-a-uuid');
      const result = normaliseBundle(fixture?.bundle, options());

      expect(result.bundle).toBeDefined();
      expect(validateFhir(result.bundle).issues.filter((issue) => issue.rule === 'ot-fullurl-uuid')).toEqual([]);
    });

    it('removes the narrative, and says that it did', () => {
      const bundle = normalised();
      const serialised = JSON.stringify(bundle);

      expect(serialised).not.toContain('Wile. E. COYOTE');
      expect(serialised).not.toContain('MRN: 23453');
      for (const entry of bundle.entry ?? []) {
        expect((entry.resource as { text?: unknown }).text).toBeUndefined();
      }
      expect(normaliseBundle(HL7_LIPIDS_BUNDLE, options()).issues.map((i) => i.rule)).toContain(
        'ot-normalised-narrative-dropped'
      );
    });

    it('does not mutate the caller input', () => {
      const before = JSON.stringify(HL7_LIPIDS_BUNDLE);
      normalised();
      expect(JSON.stringify(HL7_LIPIDS_BUNDLE)).toEqual(before);
    });

    it('rejects anything that is not a Bundle', () => {
      const result = normaliseBundle({ resourceType: 'Observation', status: 'final', code: {} }, options());
      expect(result.bundle).toBeUndefined();
      expect(result.outcome.resourceType).toBe('OperationOutcome');
    });
  });
});
