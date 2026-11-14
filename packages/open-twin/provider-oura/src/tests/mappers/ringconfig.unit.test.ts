import { SYSTEMS } from '@open-twin/fhir-core';
import type { Device, Observation } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import type { OuraRingConfigItem, OuraRingConfigResponseList } from '../../api/schemas/ringconfig';
import { mapOuraRingConfigToFHIR } from '../../fhir/mappers/ringconfig';
import { ouraExtensionUrl } from '../../fhir/mappers/shared';
import { TEST_CONTEXT, TEST_SUBJECT_REFERENCE } from '../testContext';

describe('mapOuraRingConfigToFHIR', () => {
  const baseRing: OuraRingConfigItem = {
    id: 'ring-config-1',
    set_up_at: '2026-01-15T10:00:00+01:00',
    hardware_type: 'gen3',
    color: 'stealth_black',
    design: 'horizon',
    firmware_version: '2.9.4',
    size: 10
  };

  const map = (ring: OuraRingConfigItem) => {
    const input: OuraRingConfigResponseList = { data: [ring], next_token: null };
    const [device, observation] = mapOuraRingConfigToFHIR(input, TEST_CONTEXT) as [Device, Observation];
    return { device, observation };
  };

  it('returns an empty array when the response contains no data', () => {
    expect(mapOuraRingConfigToFHIR({ data: [], next_token: null }, TEST_CONTEXT)).toEqual([]);
  });

  it('emits a Device alongside the Observation', () => {
    const { device } = map(baseRing);

    expect(device).toMatchObject({
      resourceType: 'Device',
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'ring-config-1' }],
      manufacturer: 'Oura Health',
      deviceName: [{ name: 'gen3', type: 'model-name' }],
      modelNumber: 'gen3',
      version: [{ value: '2.9.4' }]
    });
  });

  it('points Observation.device at the Device it emits, by fullUrl', () => {
    const { device, observation } = map(baseRing);

    // The reference used to be `Device/<ring configuration id>`: the wrong id, and
    // a resource no mapper in this package ever produced.
    expect(observation.device).toEqual({ reference: `urn:uuid:${device.id}` });
    expect(device.id).toBeTruthy();
  });

  it('names the device colour and design as distinct extensions', () => {
    const { device } = map(baseRing);

    expect(device.extension).toEqual([
      { url: ouraExtensionUrl('ring-color'), valueString: 'stealth_black' },
      { url: ouraExtensionUrl('ring-design'), valueString: 'horizon' }
    ]);
  });

  it('maps the Observation itself with the caller-supplied subject', () => {
    const { observation } = map(baseRing);

    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [{ system: SYSTEMS.OURA, code: 'ring-configuration', display: 'Oura Ring Configuration' }] },
      subject: { reference: TEST_SUBJECT_REFERENCE },
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: 'ring-config-1' }],
      effectiveDateTime: '2026-01-15T10:00:00+01:00'
    });
  });

  it('maps the ring size to an annotated dimensionless component', () => {
    const { observation } = map(baseRing);

    expect(observation.component).toEqual([
      {
        code: { coding: [{ system: SYSTEMS.OURA, code: 'ring-size', display: 'Ring Size' }] },
        valueQuantity: { value: 10, unit: 'US ring size', system: SYSTEMS.UCUM, code: '{ring_size}' }
      }
    ]);
  });

  it('omits effectiveDateTime when set_up_at is absent', () => {
    const { observation } = map({ ...baseRing, set_up_at: null });

    expect(observation.effectiveDateTime).toBeUndefined();
  });

  it('omits the size component when size is absent, and still says the record has no value', () => {
    const { observation } = map({ ...baseRing, size: null });

    expect(observation.component).toBeUndefined();
    expect(observation.dataAbsentReason).toEqual({
      coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'not-applicable', display: 'Not Applicable' }]
    });
  });

  it('falls back to a generic device name when hardware_type is absent', () => {
    const { device } = map({ ...baseRing, hardware_type: null, firmware_version: null, color: null, design: null });

    expect(device.deviceName).toEqual([{ name: 'Oura Ring', type: 'model-name' }]);
    expect(device.modelNumber).toBeUndefined();
    expect(device.version).toBeUndefined();
    expect(device.extension).toBeUndefined();
  });

  it('maps every entry in the list preserving order', () => {
    const input: OuraRingConfigResponseList = {
      data: [baseRing, { ...baseRing, id: 'ring-config-2' }],
      next_token: null
    };

    const resources = mapOuraRingConfigToFHIR(input, TEST_CONTEXT);

    expect(resources.map((resource) => resource.resourceType)).toEqual([
      'Device',
      'Observation',
      'Device',
      'Observation'
    ]);
    expect((resources[1] as Observation).identifier?.[0].value).toBe('ring-config-1');
    expect((resources[3] as Observation).identifier?.[0].value).toBe('ring-config-2');
  });
});
