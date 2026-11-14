import type { Observation } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { deterministicId } from '../identity';
import { createObservation } from '../observation';
import { connectorDevice, derivedObservation, deviceReference, METHOD } from '../provenance';
import { reliabilityFor } from '../reliability';
import { SYSTEMS } from '../systems';
import { quantity, UCUM } from '../units';

const SUBJECT = { reference: 'urn:uuid:cd483717-65bb-5d76-a007-ddb564f6c2cb' };

const sleepFrom = (connector: string, minutes: number): Observation =>
  createObservation({
    id: deterministicId({ connector, subjectKey: 'subject-1', recordId: 'sleep' }),
    code: { system: SYSTEMS.LOINC, code: '93832-4', display: 'Sleep duration' },
    subject: SUBJECT,
    effectiveDateTime: '2026-07-26T07:00:00+02:00',
    valueQuantity: quantity(minutes, UCUM.MINUTE)
  });

describe('connectorDevice', () => {
  it('is stable for the same device, so re-syncing does not duplicate it', () => {
    const a = connectorDevice({ connector: 'oura', deviceKey: 'ring-9' });
    const b = connectorDevice({ connector: 'oura', deviceKey: 'ring-9' });
    expect(a.id).toBe(b.id);
  });

  it('distinguishes two devices from the same connector', () => {
    const one = connectorDevice({ connector: 'oura', deviceKey: 'ring-9' });
    const two = connectorDevice({ connector: 'oura', deviceKey: 'ring-10' });
    expect(one.id).not.toBe(two.id);
  });

  it('produces a reference that resolves to the device it was built from', () => {
    // Device/<id> references were previously emitted with no Device resource in the
    // bundle, so every one of them dangled.
    const device = connectorDevice({ connector: 'oura', deviceKey: 'ring-9' });
    expect(deviceReference(device).reference).toBe(`urn:uuid:${device.id}`);
  });

  it('carries manufacturer, model and version when the vendor supplies them', () => {
    const device = connectorDevice({
      connector: 'oura',
      deviceKey: 'ring-9',
      manufacturer: 'Oura Health',
      model: 'Oura Ring Gen3',
      version: 'OSSA 2.0'
    });
    expect(device.manufacturer).toBe('Oura Health');
    expect(device.deviceName?.[0]).toEqual({ name: 'Oura Ring Gen3', type: 'model-name' });
    expect(device.version?.[0]?.value).toBe('OSSA 2.0');
  });
});

describe('METHOD', () => {
  it('says a value was estimated rather than measured', () => {
    // LOINC 94122-9 means "peak during exercise", which describes a graded exercise
    // test. A ring estimates it. The code stays; the method says how.
    expect(METHOD.DEVICE_ESTIMATED.coding?.[0]?.code).toBe('device-estimated');
    expect(METHOD.DEVICE_ESTIMATED.text).toContain('not directly measured');
  });

  it('distinguishes a sleep-derived figure from one measured awake at rest', () => {
    expect(METHOD.SLEEP_DERIVED.coding?.[0]?.code).toBe('sleep-derived');
  });
});

describe('derivedObservation', () => {
  const oura = sleepFrom('oura', 402);
  const google = sleepFrom('google-health-x', 415);
  const policy = 'Oura selected: 94.4% sleep-detection sensitivity against polysomnography (Sleep Medicine 2024).';

  const derived = derivedObservation({
    sources: [oura, google],
    selected: oura,
    policy,
    connector: 'open-twin',
    subjectKey: 'subject-1',
    measure: 'sleep-duration'
  });

  it('points at every source, not only the winner', () => {
    // The point of the design: the raw record survives. A future ranking change must
    // not require re-fetching anything.
    expect(derived.derivedFrom).toEqual([oura.id, google.id].sort().map((id) => ({ reference: `urn:uuid:${id}` })));
  });

  it('records why that source won, in readable prose', () => {
    // A selection nobody can audit is indistinguishable from a guess.
    expect(derived.method?.coding?.[0]?.code).toBe('source-selected');
    expect(derived.method?.text).toBe(policy);
  });

  it('leaves the source observations untouched', () => {
    expect(oura.derivedFrom).toBeUndefined();
    expect(google.derivedFrom).toBeUndefined();
    expect(oura.valueQuantity?.value).toBe(402);
    expect(google.valueQuantity?.value).toBe(415);
  });

  it('takes the selected value, not the first source', () => {
    const preferGoogle = derivedObservation({
      sources: [oura, google],
      selected: google,
      policy: 'test',
      connector: 'open-twin',
      subjectKey: 'subject-1',
      measure: 'sleep-duration'
    });
    expect(preferGoogle.valueQuantity?.value).toBe(415);
  });

  it('gets its own id and drops the winner’s identifier', () => {
    // It is a new assertion, not a second copy of the winner.
    expect(derived.id).not.toBe(oura.id);
    expect(derived.identifier).toBeUndefined();
  });

  it('is stable for the same inputs', () => {
    const again = derivedObservation({
      sources: [oura, google],
      selected: oura,
      policy,
      connector: 'open-twin',
      subjectKey: 'subject-1',
      measure: 'sleep-duration'
    });
    expect(again.id).toBe(derived.id);
  });

  it('refuses to derive from nothing', () => {
    expect(() =>
      derivedObservation({ sources: [], policy: 'x', connector: 'open-twin', subjectKey: 's', measure: 'm' })
    ).toThrow(TypeError);
  });

  it('refuses id-less sources rather than emitting urn:uuid:undefined provenance', () => {
    const withoutId = { ...oura, id: undefined };
    expect(() =>
      derivedObservation({
        sources: [withoutId, google],
        selected: withoutId,
        policy: 'test',
        connector: 'open-twin',
        subjectKey: 'subject-1',
        measure: 'sleep-duration'
      })
    ).toThrow(/every source must have a lowercase UUID id/);
  });

  it('derives the same identity regardless of source order', () => {
    const reversed = derivedObservation({
      sources: [google, oura],
      selected: oura,
      policy,
      connector: 'open-twin',
      subjectKey: 'subject-1',
      measure: 'sleep-duration'
    });
    expect(reversed.id).toBe(derived.id);
    expect(reversed.derivedFrom).toEqual(derived.derivedFrom);
  });
});

describe('reliabilityFor', () => {
  it('grades a measure, not a device', () => {
    // "Oura is good at sleep" is not actionable: sleep/wake detection and four-stage
    // staging have different answers for the same device.
    expect(reliabilityFor('oura', 'sleep-wake-detection')[0]?.grade).toBe('good');
    expect(reliabilityFor('oura', 'sleep-staging').some((f) => f.grade === 'fair')).toBe(true);
  });

  it('reports that no source is dependable for energy expenditure', () => {
    // MAPE above 30% on every brand tested. Ranking sources here would present a
    // confidence nobody has earned.
    const findings = reliabilityFor('google-health', 'energy-expenditure');
    expect(findings.some((f) => f.grade === 'poor')).toBe(true);
    expect(findings[0]?.evidence).toContain('30%');
  });

  it('puts the source-specific finding before the applies-to-all one', () => {
    const findings = reliabilityFor('oura', 'sleep-staging');
    expect(findings[0]?.source).toBe('oura');
    expect(findings.at(-1)?.source).toBe('*');
  });

  it('returns nothing when nobody has studied it, which is not the same as poor', () => {
    expect(reliabilityFor('vitronic', 'cross-section-area')).toEqual([]);
  });

  it('cites a source for every finding', () => {
    for (const finding of reliabilityFor('oura', 'sleep-wake-detection')) {
      expect(finding.citation.length).toBeGreaterThan(10);
    }
  });
});
