/**
 * WHAT: Builds a fixture Bundle used by emit-bundles / local verification.
 * NOT:  Must not be treated as production PHI; must not skip validator assumptions.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator (CI fhir-validate).
 */
import { ConnectorError } from '@open-twin/fhir-core';
import type { Bundle } from 'fhir/r4';
import { normaliseBundle } from '../normalise/normalise';
import { HL7_VITALS_BUNDLE } from '../samples/hl7-vitals-bundle';

const CONNECTOR = { connector: 'fhir-r4', version: '0.1.0' };

/**
 * The bundle registered in `verify/bundles.manifest.ts` and handed to the HL7
 * validator in CI.
 *
 * It is the output of this package's own normaliser run over real foreign input —
 * three vital-sign Observations HL7 publishes as examples, unaltered — rather than a
 * literal written to please the validator. A hand-written fixture would prove that
 * someone can write conformant JSON; this proves that the code path callers actually
 * use produces it.
 *
 * The input is genuinely hostile in the way real input is: every `subject` is
 * `Patient/example`, which is the precise defect decision D1 exists to end, and no
 * Patient is in the bundle at all. All three entries carry
 * `meta.profile: vitalsigns`, so the validator enforces the vital-signs profile on
 * the output and the normaliser cannot get away with a bundle that merely parses.
 *
 * No `subject` is supplied, so D1's `urn:uuid:` fallback applies and a minimal
 * Patient is added. That is the harder case, and the one where the bundle has to stay
 * internally resolvable without anyone asserting an identity.
 */
export function fhirR4IngestBundle(): Bundle {
  const result = normaliseBundle(HL7_VITALS_BUNDLE, {
    connector: CONNECTOR,
    subjectKey: 'hl7-example-vitals',
    timestamp: '2026-07-26T10:00:00Z',
    bundleKey: 'fhir-r4-hl7-vitals'
  });

  if (!result.bundle) {
    // No input is interpolated: the OperationOutcome carries the findings, and it
    // carries them as element paths rather than as values.
    throw new ConnectorError('The reference input bundle failed normalisation', {
      code: 'validation',
      connector: CONNECTOR.connector,
      operation: 'normaliseBundle(HL7_VITALS_BUNDLE)'
    });
  }

  return result.bundle;
}
