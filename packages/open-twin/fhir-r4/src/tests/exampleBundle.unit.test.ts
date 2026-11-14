import { CONNECTOR_TAG_SYSTEM } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import { validateFhir } from '../validate/validate';
import { fhirR4IngestBundle } from '../verification/exampleBundle';

/**
 * Guards the entry registered in `verify/bundles.manifest.ts`.
 *
 * The HL7 validator is the real gate and runs in CI, but it needs a JVM and twelve
 * seconds of package loading. These assertions cost a millisecond and fail on the
 * same commit rather than on the same afternoon.
 */
describe('the bundle registered for the HL7 validator', () => {
  const bundle = fhirR4IngestBundle();

  it('is a collection Bundle built from the four HL7 example resources plus a subject', () => {
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(bundle.entry).toHaveLength(4);
    expect(bundle.entry?.filter((entry) => entry.resource?.resourceType === 'Patient')).toHaveLength(1);
    expect(bundle.entry?.filter((entry) => entry.resource?.resourceType === 'Observation')).toHaveLength(3);
  });

  it('passes the validator in this package with no errors', () => {
    const result = validateFhir(bundle);
    expect(result.issues.filter((issue) => issue.severity === 'error' || issue.severity === 'fatal')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('carries no reference to Patient/example anywhere', () => {
    expect(JSON.stringify(bundle)).not.toContain('Patient/example');
  });

  it('is byte-for-byte reproducible', () => {
    expect(JSON.stringify(fhirR4IngestBundle())).toEqual(JSON.stringify(bundle));
  });

  it('carries connector provenance on the bundle and on every resource', () => {
    const tag = (meta: { tag?: Array<{ system?: string; code?: string }> } | undefined) =>
      meta?.tag?.find((item) => item.system === CONNECTOR_TAG_SYSTEM);
    expect(tag(bundle.meta)?.code).toBe('fhir-r4');
    for (const entry of bundle.entry ?? []) expect(tag(entry.resource?.meta)?.code).toBe('fhir-r4');
  });

  it('keeps the units the HL7 examples state, all three of which D4 already agrees with', () => {
    const quantities = (bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource) => resource?.resourceType === 'Observation')
      .map((resource) => (resource as { valueQuantity?: { value?: number; code?: string } }).valueQuantity);

    expect(quantities).toEqual([
      { value: 44, unit: 'beats/minute', system: 'http://unitsofmeasure.org', code: '/min' },
      { value: 95, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
      { value: 25, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' }
    ]);
  });
});
