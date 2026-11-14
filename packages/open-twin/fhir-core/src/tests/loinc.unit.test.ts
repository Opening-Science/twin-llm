import { describe, expect, it } from 'vitest';
import { LOINC_CODINGS } from '../loinc';
import { LOINC_UNITS } from '../units';

describe('shared LOINC codings', () => {
  it('publishes the canonical reviewed coding values', () => {
    expect(LOINC_CODINGS).toEqual({
      HEART_RATE: {
        system: 'http://loinc.org',
        code: '8867-4',
        display: 'Heart rate'
      },
      OXYGEN_SATURATION: {
        system: 'http://loinc.org',
        code: '59408-5',
        display: 'Oxygen saturation in Arterial blood by Pulse oximetry'
      },
      TIME_IN_BED: {
        system: 'http://loinc.org',
        code: '103213-5',
        display: 'Duration in bed'
      }
    });
  });

  it('contains no duplicate LOINC codes', () => {
    const codes = Object.values(LOINC_CODINGS).map(({ code }) => code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has a shared UCUM policy for every coding', () => {
    for (const { code } of Object.values(LOINC_CODINGS)) {
      expect(LOINC_UNITS[code]).toBeDefined();
    }
  });
});
