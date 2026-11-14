import type { Observation } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { buildBundle, CONNECTOR_TAG_SYSTEM, connectorMeta } from '../bundle';
import { SYSTEMS } from '../systems';

const CONNECTOR = { connector: 'oura', version: '0.1.0' };
const TIMESTAMP = '2026-07-26T10:00:00Z';

const observation = (id?: string): Observation => ({
  resourceType: 'Observation',
  ...(id ? { id } : {}),
  status: 'final',
  code: { coding: [{ system: SYSTEMS.LOINC, code: '8867-4' }] },
  subject: { reference: 'urn:uuid:cd483717-65bb-5d76-a007-ddb564f6c2cb' }
});

describe('connectorMeta', () => {
  it('tags output with the connector and its version', () => {
    // Without this, a bundle produced before the radians fix is indistinguishable
    // from one produced after — both plausible, both structurally valid — so
    // corrupted historical data can never be found and re-fetched.
    const meta = connectorMeta(CONNECTOR);
    expect(meta.tag?.[0]).toEqual({ system: CONNECTOR_TAG_SYSTEM, code: 'oura', version: '0.1.0' });
  });
});

describe('buildBundle', () => {
  it('gives the bundle an id and a timestamp', () => {
    const bundle = buildBundle({
      connector: CONNECTOR,
      resources: [observation('a')],
      timestamp: TIMESTAMP,
      bundleKey: 'k'
    });
    expect(bundle.id).toBeTruthy();
    expect(bundle.timestamp).toBe(TIMESTAMP);
  });

  it('gives every entry a fullUrl that matches its resource id', () => {
    // Without fullUrl, an intra-bundle reference resolves to nothing.
    const bundle = buildBundle({
      connector: CONNECTOR,
      resources: [observation()],
      timestamp: TIMESTAMP,
      bundleKey: 'k'
    });
    expect(bundle.entry?.[0]?.fullUrl).toBe(`urn:uuid:${bundle.entry?.[0]?.resource?.id}`);
  });

  it('canonicalises a non-UUID id, because urn:uuid: requires a real UUID', () => {
    // Found by the HL7 validator on its first run against this package:
    //   "Bundle.entry[1].fullUrl: Error - UUIDs must be valid and lowercase"
    // A human-readable id such as `oura-activity-123` is not a UUID, so emitting
    // `urn:uuid:oura-activity-123` is an error, not a warning.
    const bundle = buildBundle({
      connector: CONNECTOR,
      resources: [observation('oura-activity-123')],
      timestamp: TIMESTAMP,
      bundleKey: 'k'
    });
    const id = bundle.entry?.[0]?.resource?.id ?? '';
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(bundle.entry?.[0]?.fullUrl).toBe(`urn:uuid:${id}`);
  });

  it('passes a UUID id through unchanged', () => {
    const uuid = 'cd483717-65bb-5d76-a007-ddb564f6c2cb';
    const bundle = buildBundle({
      connector: CONNECTOR,
      resources: [observation(uuid)],
      timestamp: TIMESTAMP,
      bundleKey: 'k'
    });
    expect(bundle.entry?.[0]?.resource?.id).toBe(uuid);
  });

  it('is reproducible: the same input yields the same bundle', () => {
    const build = () =>
      buildBundle({ connector: CONNECTOR, resources: [observation('a')], timestamp: TIMESTAMP, bundleKey: 'k' });
    expect(build()).toEqual(build());
  });

  it('emits PUT requests for a transaction bundle, so re-sync upserts', () => {
    const bundle = buildBundle({
      connector: CONNECTOR,
      resources: [observation('a')],
      timestamp: TIMESTAMP,
      bundleKey: 'k',
      type: 'transaction'
    });
    expect(bundle.type).toBe('transaction');
    expect(bundle.entry?.[0]?.request).toEqual({
      method: 'PUT',
      url: `Observation/${bundle.entry?.[0]?.resource?.id}`
    });
  });

  it('never nests a Bundle inside a Bundle entry', () => {
    // The defect: the personal Bundle was pushed as an entry of the outer Bundle,
    // so a consumer iterating entries as Observations silently skipped Patient,
    // weight, height and sex — which is what made the only real Patient in the
    // repository unreachable.
    const bundle = buildBundle({
      connector: CONNECTOR,
      resources: [observation('a'), observation('b')],
      timestamp: TIMESTAMP,
      bundleKey: 'k'
    });
    expect(bundle.entry?.every((entry) => entry.resource?.resourceType !== 'Bundle')).toBe(true);
  });
});
