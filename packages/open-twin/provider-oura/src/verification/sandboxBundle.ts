/**
 * WHAT: Builds a fixture Bundle used by emit-bundles / local verification.
 * NOT:  Must not be treated as production PHI; must not skip validator assumptions.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 validator (CI fhir-validate); Oura sandbox path additionally uses recorded vendor sandbox responses where applicable.
 */
import type { Bundle } from 'fhir/r4';
import type { RequestParams } from '../api/schemas/client';
import { buildOuraBundle } from '../fhir/bundleBuilder';
import capture from '../tests/fixtures/sandbox-capture.json';
import { parseOuraResponse } from '../utils/objectUtils';
import type { OuraTypedData } from '../utils/typeUtils';

/**
 * The recorded Oura sandbox capture, driven all the way to a Bundle.
 *
 * `exampleBundle` next to this file is built from payloads written while writing the
 * mappers, and it covers six of the thirteen scopes Oura serves. That is the shape of
 * gap this exists to close: a fixture authored from the same understanding as the code
 * agrees with the code whether or not the understanding is right, and a scope no
 * fixture exercises is a scope no gate has ever looked at.
 *
 * Both halves were already tested and never joined. `sandboxFixture.unit.test.ts` runs
 * the capture through the connector's schemas but stops there; `exampleBundle` runs
 * hand-written payloads through the mappers. Nothing ran real vendor data through the
 * mappers, and two defects lived in that seam until it was closed:
 *
 *   - six extensions were emitted and never declared, so the validator rejected them
 *     36 times over. The declarations mechanism was built precisely to make an
 *     undeclared extension fail the build, but it only ever saw the six scopes the
 *     exemplar requested.
 *   - every Observation referenced a Patient that was not in the bundle, because the
 *     sandbox returns 404 for `personal_info` and nothing supplied one in its place.
 *
 * `personal_info` is absent here for that reason, which makes this the fixture that
 * holds the synthesised Patient in place: if `minimalPatient` stops being emitted, the
 * validator reports an unresolved URN reference for every Observation in this bundle.
 *
 * See fixtures/PROVENANCE.md for what the capture is and what it is not.
 */

const SCOPES = Object.keys(capture as Record<string, unknown>);

/** Fixed so the bundle is reproducible; the capture is a recording, not a live sync. */
const REQUEST: RequestParams = {
  types: SCOPES as RequestParams['types'],
  start_date: '2026-06-20',
  end_date: '2026-06-27'
};

export function ouraSandboxBundle(): Bundle {
  const data: OuraTypedData[] = SCOPES.map((scope) =>
    parseOuraResponse(scope as never, (capture as Record<string, unknown>)[scope] as never)
  );

  return buildOuraBundle(data, REQUEST, {
    timestamp: '2026-07-26T10:00:00Z',
    // The sandbox serves no `personal_info`, so there is no vendor subject id to key
    // from. A caller in this position must supply one, and the Patient that answers
    // the resulting reference is synthesised rather than invented from demographics.
    subjectKey: 'sandbox-subject'
  });
}
