/**
 * WHAT: Builds a fixture Bundle used by emit-bundles / local verification.
 * NOT:  Must not be treated as production PHI.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2
 * CORRECTNESS: HL7 validator (CI) when registered in verify/bundles.manifest.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bundle } from 'fhir/r4';
import { WhoopSyncPayloadSchema } from '../api/schemas/sync';
import { buildWhoopBundleFromPayload } from '../fhir/bundleBuilder';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/whoop-sync.json');

export function whoopBundle(): Bundle {
  const payload = WhoopSyncPayloadSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
  return buildWhoopBundleFromPayload(payload, {
    subjectKey: 'whoop-exemplar-wearer',
    timestamp: '2026-07-26T10:00:00Z'
  });
}
