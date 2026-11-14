import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deterministicId } from '@open-twin/fhir-core';
import type { Bundle, Observation } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { normaliseBundle } from '../normalise/normalise';
import { validateFhir } from '../validate/validate';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/synthea');
const CONNECTOR = { connector: 'synthea', version: '4.0.0' };
const NORMALISED_AT = '2026-09-25T00:00:00Z';

interface SyntheaFixture {
  name: string;
  bundle: unknown;
}

function loadBundles(): SyntheaFixture[] {
  return readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, bundle: JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) }));
}

function entries(bundle: Bundle) {
  return bundle.entry ?? [];
}

function observations(bundle: Bundle): Observation[] {
  return entries(bundle)
    .map((entry) => entry.resource)
    .filter((resource): resource is Observation => resource?.resourceType === 'Observation');
}

function normaliseFixture(fixture: SyntheaFixture) {
  const bundle = fixture.bundle as Bundle;
  const patientEntry = entries(bundle).find((entry) => entry.resource?.resourceType === 'Patient');
  const patientId = patientEntry?.resource?.id;
  if (!patientId || !patientEntry.fullUrl) {
    throw new Error(`${fixture.name}: expected one Patient with an id and fullUrl`);
  }

  const normalisedPatientId = deterministicId({
    connector: CONNECTOR.connector,
    subjectKey: patientId,
    recordId: patientEntry.fullUrl,
    measure: 'Patient'
  });

  return normaliseBundle(fixture.bundle, {
    connector: CONNECTOR,
    subjectKey: patientId,
    subject: { reference: `urn:uuid:${normalisedPatientId}` },
    timestamp: NORMALISED_AT,
    bundleKey: fixture.name,
    type: 'collection',
    unresolvedUrnPolicy: 'preserve'
  });
}

const EXPECTED_OBSERVATIONS = [
  {
    fixture: 'patient-1.json',
    resourceId: 'ba419d35-0dfe-8af7-c87f-192dff932af1',
    codings: [
      { system: 'http://loinc.org', code: '79893-4', display: 'Left eye Intraocular pressure' },
      { system: 'http://loinc.org', code: '41633001', display: 'Intraocular pressure (observable entity)' }
    ],
    valueQuantity: {
      value: 17,
      unit: 'mm[Hg]',
      system: 'http://unitsofmeasure.org',
      code: 'mm[Hg]'
    },
    effectiveDateTime: '2017-02-24T06:35:42+01:00'
  },
  {
    fixture: 'patient-2.json',
    resourceId: '4f083ce3-f12b-bb4b-c1c7-160cc37081e4',
    codings: [{ system: 'http://loinc.org', code: '8302-2', display: 'Body Height' }],
    valueQuantity: {
      value: 175.3,
      unit: 'cm',
      system: 'http://unitsofmeasure.org',
      code: 'cm'
    },
    effectiveDateTime: '2017-02-11T04:29:26+01:00'
  },
  {
    fixture: 'patient-3.json',
    resourceId: 'aee7bbe1-0c45-c028-f7e9-8659e6a0bcfc',
    codings: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body Weight' }],
    valueQuantity: {
      value: 21.9,
      unit: 'kg',
      system: 'http://unitsofmeasure.org',
      code: 'kg'
    },
    effectiveDateTime: '2016-11-13T22:33:18+01:00'
  }
] as const;

describe('synthea trimmed fixtures', () => {
  const fixtures = loadBundles();

  it('ships exactly three patient bundles', () => {
    expect(fixtures).toHaveLength(3);
  });

  it.each(fixtures)('$name is a collection Bundle with one Patient and five Observations', ({ bundle }) => {
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    const resources = entries(bundle as Bundle);
    expect(resources.filter((entry) => entry.resource?.resourceType === 'Patient')).toHaveLength(1);
    expect(resources.filter((entry) => entry.resource?.resourceType === 'Observation')).toHaveLength(5);
  });

  it('each fixture passes structural validateFhir with no errors', () => {
    for (const { bundle } of fixtures) {
      const result = validateFhir(bundle);
      expect(result.issues.filter((i) => i.severity === 'error' || i.severity === 'fatal')).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it.each(EXPECTED_OBSERVATIONS)(
    '$fixture preserves $resourceId code, value, unit and timestamp',
    ({ fixture: fixtureName, resourceId, codings, valueQuantity, effectiveDateTime }) => {
      const fixture = fixtures.find(({ name }) => name === fixtureName);
      if (!fixture) throw new Error(`missing fixture ${fixtureName}`);
      const source = observations(fixture.bundle as Bundle).find((observation) => observation.id === resourceId);
      const result = normaliseFixture(fixture);
      const normalised = observations(result.bundle as Bundle).find((observation) =>
        observation.code.coding?.some((coding) => coding.code === codings[0].code)
      );

      expect(source?.code.coding).toEqual(codings);
      expect(source?.valueQuantity).toEqual(valueQuantity);
      expect(source?.effectiveDateTime).toBe(effectiveDateTime);
      expect(normalised?.code.coding).toEqual(codings);
      expect(normalised?.valueQuantity).toEqual(valueQuantity);
      expect(normalised?.effectiveDateTime).toBe(effectiveDateTime);
    }
  );

  it.each(fixtures)('$name normalises to byte-identical JSON twice', (fixture) => {
    const first = normaliseFixture(fixture);
    const second = normaliseFixture(fixture);

    expect(first.bundle).toBeDefined();
    expect(JSON.stringify(first.bundle)).toBe(JSON.stringify(second.bundle));
  });

  it.each(fixtures)('$name keeps every Observation subject resolvable without fabricating a Patient', (fixture) => {
    const source = fixture.bundle as Bundle;
    const result = normaliseFixture(fixture);
    const bundle = result.bundle as Bundle;
    const fullUrls = new Set(entries(bundle).map((entry) => entry.fullUrl));
    const patients = entries(bundle).filter((entry) => entry.resource?.resourceType === 'Patient');
    const sourceEncounterReferences = observations(source).map((observation) => observation.encounter?.reference);
    const normalisedEncounterReferences = observations(bundle).map((observation) => observation.encounter?.reference);
    const typedOrphans = result.issues.filter(
      (issue) => issue.rule === 'ot-normalised-patient-orphaned' || issue.rule === 'ot-normalised-subject-external'
    );

    expect(patients).toHaveLength(1);
    for (const observation of observations(bundle)) {
      expect(observation.subject?.reference).toMatch(/^urn:uuid:/);
      expect(fullUrls.has(observation.subject?.reference)).toBe(true);
    }
    expect(typedOrphans).toEqual([]);
    expect(normalisedEncounterReferences).toEqual(sourceEncounterReferences);
    expect(result.issues.filter((issue) => issue.rule === 'ot-reference-unresolved-urn')).toHaveLength(5);
    for (const entry of entries(bundle)) {
      expect(entry.fullUrl).toBe(`urn:uuid:${entry.resource?.id}`);
    }
  });
});
