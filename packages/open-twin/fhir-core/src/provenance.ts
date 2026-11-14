/**
 * WHAT: Device, METHOD vocabulary, and derivedObservation helpers.
 * NOT:  Must not delete source Observations when deriving; aggregate keeps sources.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { CodeableConcept, Device, Observation, Reference } from 'fhir/r4';
import { deterministicId, uuidv5 } from './identity';
import { codeableConcept } from './observation';
import { deviceIdentifierSystem, SYSTEMS } from './systems';

/**
 * Which device produced a measurement, and — when several did — which one was chosen
 * and why.
 *
 * This stops being optional the moment one person's record carries observations from
 * more than one source. Three connectors reporting sleep duration for the same night
 * produce three Observations under an identical LOINC code; without a device on each,
 * a consumer sees three numbers and no way to tell them apart, let alone prefer one.
 * That is not a hypothetical here — 18 of the 23 clinical codes this project emits
 * are emitted by more than one connector.
 */

export interface DeviceInput {
  /** The connector that produced the data, e.g. 'oura'. */
  connector: string;
  /** Stable vendor identifier for the device, where one is available. */
  deviceKey?: string;
  manufacturer?: string;
  /** Model name as the vendor writes it. */
  model?: string;
  /** Firmware or algorithm version, when the vendor exposes it. */
  version?: string;
}

/**
 * A Device resource for the thing that took the measurement.
 *
 * `Device/<id>` references were previously emitted with no Device resource anywhere
 * in the bundle, so every one of them dangled. A reference a receiver cannot resolve
 * is worse than no reference: it implies provenance exists and then withholds it.
 */
export function connectorDevice(input: DeviceInput): Device {
  const key = input.deviceKey ?? input.connector;
  const device: Device = {
    resourceType: 'Device',
    id: uuidv5(`device|${input.connector}|${key}`),
    identifier: [{ system: deviceIdentifierSystem(input.connector), value: key }]
  };
  if (input.manufacturer) device.manufacturer = input.manufacturer;
  if (input.model) device.deviceName = [{ name: input.model, type: 'model-name' }];
  if (input.version) device.version = [{ value: input.version }];
  return device;
}

export function deviceReference(device: Device): Reference {
  return { reference: `urn:uuid:${device.id}` };
}

/**
 * Records that a value is a device's model output rather than a direct measurement.
 *
 * A consumer VO2max is the clearest case: LOINC 94122-9 means "peak during exercise",
 * which properly describes a graded exercise test with a metabolic cart. A ring or a
 * watch estimates it — the best published agreement is around 7% mean absolute error.
 * The code is still the least-wrong standard option, so the honest fix is to keep the
 * code and say plainly how the number was arrived at.
 */
export const METHOD = {
  DEVICE_ESTIMATED: codeableConcept(
    { system: SYSTEMS.METHOD, code: 'device-estimated' },
    'Estimated by the device from sensor data, not directly measured'
  ),
  DEVICE_MEASURED: codeableConcept(
    { system: SYSTEMS.METHOD, code: 'device-measured' },
    'Measured directly by the device sensor'
  ),
  SLEEP_DERIVED: codeableConcept(
    { system: SYSTEMS.METHOD, code: 'sleep-derived' },
    'Derived from the sleep period rather than measured awake at rest'
  )
} as const;

export interface DerivedObservationInput {
  /** The observations this one was selected or computed from. All of them. */
  sources: Observation[];
  /** The one selected, when the policy selects rather than computes. */
  selected?: Observation;
  /**
   * Why this source won, in prose a clinician can read. Recorded on the resource
   * because a selection nobody can audit is indistinguishable from a guess.
   */
  policy: string;
  connector: string;
  subjectKey: string;
  measure: string;
}

const FHIR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A derived Observation that points at everything it came from.
 *
 * Deliberately additive: the source observations stay in the bundle untouched. Writing
 * a single winner and discarding the rest bakes today's ranking into historical data,
 * and the ranking will change — device firmware changes, validation studies are
 * published, and a measure like energy expenditure has no dependable source at all.
 * Keeping the raw record means the interpretation layer can be revised without
 * re-fetching anything.
 *
 * `derivedFrom` carries the lineage, `method` carries the policy. Both are standard
 * R4 elements, so this needs no extension and no receiver-side agreement.
 */
export function derivedObservation(input: DerivedObservationInput): Observation {
  const template = input.selected ?? input.sources[0];
  if (!template) {
    throw new TypeError('derivedObservation: at least one source observation is required');
  }

  const sourceIds = input.sources.map((source) => source.id);
  if (sourceIds.some((id) => typeof id !== 'string' || !FHIR_UUID.test(id))) {
    throw new TypeError(
      'derivedObservation: every source must have a lowercase UUID id before provenance can be created'
    );
  }
  const orderedSourceIds = (sourceIds as string[]).sort();

  // The derived resource is a new assertion, not a copy of the winner's identity, so
  // the source's business identifier is left out rather than deleted afterwards.
  const { identifier: _sourceIdentifier, ...withoutIdentifier } = template;

  const derived: Observation = {
    ...withoutIdentifier,
    id: deterministicId({
      connector: input.connector,
      subjectKey: input.subjectKey,
      recordId: orderedSourceIds.join('+'),
      measure: `derived/${input.measure}`
    }),
    derivedFrom: orderedSourceIds.map((id) => ({ reference: `urn:uuid:${id}` })),
    method: selectionMethod(input.policy)
  };
  return derived;
}

function selectionMethod(policy: string): CodeableConcept {
  return {
    coding: [
      {
        system: SYSTEMS.METHOD,
        code: 'source-selected'
      }
    ],
    text: policy
  };
}
