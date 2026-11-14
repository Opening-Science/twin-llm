/**
 * WHAT: Canonical, reviewed LOINC codings shared across connectors.
 * NOT:  Must not invent terminology or attach anatomy, interpretation, or units.
 * GOVERNED BY: DECISIONS.md#d3; DECISIONS.md#d4; verify/terminology-allowlist.json
 * CORRECTNESS: Signed terminology review records for every code in this table.
 */
import type { CodingInput } from './observation';
import { SYSTEMS } from './systems';

export const LOINC_CODINGS = {
  HEART_RATE: { system: SYSTEMS.LOINC, code: '8867-4', display: 'Heart rate' },
  OXYGEN_SATURATION: {
    system: SYSTEMS.LOINC,
    code: '59408-5',
    display: 'Oxygen saturation in Arterial blood by Pulse oximetry'
  },
  TIME_IN_BED: { system: SYSTEMS.LOINC, code: '103213-5', display: 'Duration in bed' }
} as const satisfies Record<string, CodingInput>;
