import ucum from '@lhncbc/ucum-lhc';
import { describe, expect, it } from 'vitest';
import { glucoseCodeFor, LOINC_UNITS, quantity, UCUM } from '../units';

/**
 * These assert against an external authority — the real UCUM grammar — rather than
 * against what the code currently produces.
 *
 * That distinction is the entire point. The repository shipped `unit: 'steps'` with
 * `code: 'steps'` under the UCUM system, and a unit test asserted exactly that
 * output, so a 270-test suite stayed green over a code no UCUM-validating server
 * will accept. Adding more tests in that style increases confidence without
 * increasing correctness.
 */
const utils = ucum.UcumLhcUtils.getInstance();

const validate = (code: string) => utils.validateUnitString(code, true).status;

describe('UCUM table', () => {
  const entries = Object.entries(UCUM);

  it.each(entries)('%s has a code that is valid UCUM', (_name, unit) => {
    expect(validate(unit.code)).toBe('valid');
  });

  it('rejects the bare forms that previously shipped', () => {
    // The defects this gate exists to prevent, asserted as failures.
    expect(validate('steps')).not.toBe('valid');
    expect(validate('count')).not.toBe('valid');
    expect(validate('score')).not.toBe('valid');
    expect(validate('MET-min')).not.toBe('valid');
  });

  it('treats an annotation as the unity, so a label cannot carry meaning', () => {
    // UCUM 6-4: an annotation with no leading symbol implies the unit 1.
    // This is why Observation.code must be right: {steps} and {beats} compare equal.
    expect(validate('{steps}')).toBe('valid');
    expect(validate('{beats}')).toBe('valid');
  });

  it('distinguishes absolute temperature from a difference', () => {
    // UCUM 21/22: Cel is a special unit on an interval scale. A deviation is K.
    expect(UCUM.CELSIUS.code).toBe('Cel');
    expect(UCUM.KELVIN.code).toBe('K');
    expect(UCUM.CELSIUS.code).not.toBe(UCUM.KELVIN.code);
  });

  it('knows radians and degrees are different units of the same dimension', () => {
    const converted = utils.convertUnitTo('rad', 1, 'deg');
    expect(converted.status).toBe('succeeded');
    // 1 rad = 180/pi deg. Emitting a radian value under 'deg' understates every
    // angle by this factor: an 84.9 degree joint angle publishes as 1.48.
    expect(converted.toVal).toBeCloseTo(57.2957795, 5);
  });
});

describe('LOINC unit policy', () => {
  it.each(Object.entries(LOINC_UNITS))('%s binds to a valid UCUM code', (_loinc, unit) => {
    expect(validate(unit.code)).toBe('valid');
  });

  it('binds one unit per LOINC code, so two connectors cannot disagree', () => {
    // The defect: Oura emitted 93832-4 as unitless seconds while Google Health
    // emitted the same code as 'min'. Merged bundles contradicted each other.
    expect(LOINC_UNITS['93832-4']).toBe(UCUM.MINUTE);
    expect(LOINC_UNITS['93829-0']).toBe(UCUM.MINUTE);
  });

  it('uses cm for body height, which the vital-signs profile requires', () => {
    // ucum-bodylength is a *required* binding to exactly {cm, [in_i]}.
    // Oura sent 'm' and Google Health sent 'mm'; both fail the profile.
    expect(LOINC_UNITS['8302-2']).toBe(UCUM.CENTIMETRE);
  });

  it('uses /min for heart rate, which the profile fixes', () => {
    // heartrate.profile.json fixes valueQuantity.code to '/min'.
    // {beats}/min is absent from ucum-vitals-common.
    expect(LOINC_UNITS['8867-4']?.code).toBe('/min');
    expect(LOINC_UNITS['103222-6']?.code).toBe('/min');
  });
});

describe('quantity()', () => {
  it('builds a UCUM quantity', () => {
    expect(quantity(95, UCUM.PERCENT)).toEqual({
      value: 95,
      unit: '%',
      system: 'http://unitsofmeasure.org',
      code: '%'
    });
  });

  it.each([[undefined], [null], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'returns undefined rather than emitting a unit with no value for %s',
    (value) => {
      // A Quantity carrying unit and code but no value is structurally invalid
      // FHIR, and NaN previously serialised as the literal string "null".
      expect(quantity(value as number | null | undefined, UCUM.METRE)).toBeUndefined();
    }
  );
});

describe('glucoseCodeFor', () => {
  it('picks the mass-concentration code for mg/dL', () => {
    expect(glucoseCodeFor(UCUM.MG_PER_DL)?.code).toBe('2339-0');
  });

  it('picks the substance-concentration code for mmol/L', () => {
    // Consumer platforms report glucose in either unit. A connector that hardcodes
    // 2339-0 and passes the vendor's unit through will eventually publish mmol/L
    // under a mass-concentration code — the same property mismatch that put a
    // weight-indexed VO2max under absolute-VO2 LOINC 60842-2.
    expect(glucoseCodeFor(UCUM.MMOL_PER_L)?.code).toBe('15074-8');
  });

  it('returns undefined for a unit neither code covers, rather than guessing', () => {
    expect(glucoseCodeFor(UCUM.PERCENT)).toBeUndefined();
    expect(glucoseCodeFor(UCUM.MINUTE)).toBeUndefined();
  });

  it('binds each glucose code to its own unit in the shared policy', () => {
    expect(LOINC_UNITS['2339-0']).toBe(UCUM.MG_PER_DL);
    expect(LOINC_UNITS['15074-8']).toBe(UCUM.MMOL_PER_L);
  });
});
