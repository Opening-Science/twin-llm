/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { CATEGORY, createObservation, dataAbsentReason, SYSTEMS } from '@open-twin/fhir-core';
import type { Device, Extension, FhirResource } from 'fhir/r4';
import type { OuraRingConfigResponseList } from '../../api/schemas/ringconfig';
import {
  localNumericComponent,
  OURA_UNITS,
  type OuraMapperContext,
  ouraCoding,
  ouraExtensionUrl,
  ouraIdentifier,
  ouraResourceId
} from './shared';

/**
 * Emits the Device as well as the Observation.
 *
 * `Observation.device` previously referenced `Device/<ring-configuration id>` —
 * both the wrong id and a resource no mapper in this package ever built, so the
 * reference dangled in every bundle. This endpoint carries the hardware fields, so
 * it is the one place that can honestly produce the Device.
 */
export function mapOuraRingConfigToFHIR(
  ouraData: OuraRingConfigResponseList,
  context: OuraMapperContext
): FhirResource[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  const resources: FhirResource[] = [];

  for (const ring of ouraData.data) {
    const deviceId = ouraResourceId(context, ring.id, 'device');

    const deviceExtensions: Extension[] = [];
    if (ring.color) deviceExtensions.push({ url: ouraExtensionUrl('ring-color'), valueString: ring.color });
    if (ring.design) deviceExtensions.push({ url: ouraExtensionUrl('ring-design'), valueString: ring.design });

    const device: Device = {
      resourceType: 'Device',
      id: deviceId,
      identifier: [{ system: SYSTEMS.OURA_IDENTIFIER, value: ring.id }],
      manufacturer: 'Oura Health',
      deviceName: [{ name: ring.hardware_type ?? 'Oura Ring', type: 'model-name' }]
    };
    if (ring.hardware_type) device.modelNumber = ring.hardware_type;
    if (ring.firmware_version) device.version = [{ value: ring.firmware_version }];
    if (deviceExtensions.length > 0) device.extension = deviceExtensions;

    resources.push(device);

    resources.push(
      createObservation({
        id: ouraResourceId(context, ring.id, 'ring-configuration'),
        identifier: ouraIdentifier(ring.id),
        code: ouraCoding('ring-configuration', 'Oura Ring Configuration'),
        category: CATEGORY.ACTIVITY,
        subject: context.subject,
        effectiveDateTime: ring.set_up_at ?? undefined,
        // Collection bundles resolve intra-bundle references by fullUrl, which
        // `buildBundle` writes as `urn:uuid:<resource id>`.
        device: { reference: `urn:uuid:${deviceId}` },
        // A configuration record is a description of hardware, not a measurement.
        dataAbsentReason: dataAbsentReason('not-applicable'),
        components: [
          // US ring size is an ordinal label on a dimensionless number; UCUM §6■4
          // makes `{ring_size}` the unity carrying that label.
          localNumericComponent(ouraCoding('ring-size', 'Ring Size'), ring.size, OURA_UNITS.RING_SIZE)
        ]
      })
    );
  }

  return resources;
}
