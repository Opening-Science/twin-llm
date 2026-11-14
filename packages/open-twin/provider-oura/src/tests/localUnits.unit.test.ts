import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { OURA_UNITS } from '../fhir/mappers/shared';

/**
 * The repo-wide UCUM gate reads the shared table in `@open-twin/fhir-core`. The
 * handful of pairs this connector defines locally — because they belong to one
 * Oura measure each and do not belong in a cross-connector contract — are outside
 * that scan, so they are validated here against the published UCUM grammar instead
 * of being taken on trust.
 */
const require = createRequire(import.meta.url);
const ucum = require('@lhncbc/ucum-lhc').UcumLhcUtils.getInstance();

/** LOINC 41979-6's own example unit; built at its single call site in daily.ts. */
const KCAL_PER_24H = { unit: 'kcal/24h', code: 'kcal/(24.h)' };

describe('connector-local UCUM pairs', () => {
  it.each([...Object.values(OURA_UNITS), KCAL_PER_24H])('%o is a valid UCUM code', (pair) => {
    expect(ucum.validateUnitString(pair.code, false).status).toBe('valid');
  });

  it('never uses a bare word where UCUM requires an annotation', () => {
    for (const pair of [...Object.values(OURA_UNITS), KCAL_PER_24H]) {
      // `steps`, `size` and `score` are not UCUM symbols. A countable thing is an
      // annotation in braces, per UCUM §6.
      expect(pair.code).not.toMatch(/^[A-Za-z_]+$/);
    }
  });
});
