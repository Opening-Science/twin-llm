import { LOINC_UNITS, SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import { checkUcumCodes, checkUnitPolicy } from '../units/check';
import { areCommensurable, isValidUcum } from '../units/ucum';

const observation = (code: string, quantity: Record<string, unknown>) => ({
  resourceType: 'Observation',
  status: 'final',
  code: { coding: [{ system: SYSTEMS.LOINC, code }] },
  valueQuantity: quantity
});

describe('UCUM grammar', () => {
  it.each([
    ['{steps}', true],
    ['{beats}/min', true],
    ['{MET-min}', true],
    ['/min', true],
    ['mL/kg/min', true],
    ['[in_i]', true],
    ['Cel', true],
    ['%', true],
    ['1', true],
    // The four that matter. Every one of them looks like a unit and is not one.
    ['steps', false],
    ['beats/minute', false],
    ['bpm', false],
    ['', false]
  ])('%s', (code, valid) => {
    expect(isValidUcum(code)).toBe(valid);
  });

  it('accepts an annotation and rejects the same word unbraced', () => {
    // UCUM section 6: material inside curly braces is an annotation and a conformant
    // parser discards it. `steps` unbraced is not a symbol at all, which is why a
    // server validating UCUM rejects the whole resource.
    expect(isValidUcum('{steps}')).toBe(true);
    expect(isValidUcum('steps')).toBe(false);
  });
});

describe('commensurability', () => {
  it.each([
    ['s', 'min', true],
    ['[in_i]', 'cm', true],
    ['m', 'cm', true],
    ['Cel', 'K', true],
    ['{beats}/min', '/min', true],
    ['{steps}', '1', true],
    ['kg', 'min', false],
    ['deg', 'kg', false]
  ])('%s against %s', (from, to, expected) => {
    expect(areCommensurable(from, to)).toBe(expected);
  });

  it('does not treat an unparseable code as commensurable with anything', () => {
    expect(areCommensurable('steps', '{steps}')).toBe(false);
  });
});

describe('checkUcumCodes', () => {
  it('reports a unit code that does not parse', () => {
    const issues = checkUcumCodes(
      observation('55423-8', { value: 8214, unit: 'steps', system: SYSTEMS.UCUM, code: 'steps' }),
      'Observation'
    );
    expect(issues.map((issue) => issue.rule)).toEqual(['ot-ucum-invalid']);
    expect(issues[0]?.expression).toBe('Observation.valueQuantity.code');
  });

  it('reports a UCUM system with no code at all', () => {
    const issues = checkUcumCodes(observation('8867-4', { value: 62, system: SYSTEMS.UCUM }), 'Observation');
    expect(issues.map((issue) => issue.rule)).toEqual(['ot-quantity-no-code']);
  });

  it('reports a Quantity whose unit is only a human-readable label', () => {
    const issues = checkUcumCodes(observation('8867-4', { value: 62, unit: 'beats/minute' }), 'Observation');
    expect(issues.map((issue) => issue.rule)).toEqual(['ot-quantity-no-system']);
  });

  it('checks units wherever they occur, not only in value[x]', () => {
    const withRange = {
      ...observation('59408-5', { value: 95, unit: '%', system: SYSTEMS.UCUM, code: '%' }),
      referenceRange: [{ low: { value: 90, unit: 'percent', system: SYSTEMS.UCUM, code: 'percent' } }]
    };
    const issues = checkUcumCodes(withRange, 'Observation');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.expression).toBe('Observation.referenceRange[0].low.code');
  });

  it('says nothing about a Quantity that is entirely correct', () => {
    expect(
      checkUcumCodes(
        observation('8867-4', { value: 62, unit: 'per minute', system: SYSTEMS.UCUM, code: '/min' }),
        'Observation'
      )
    ).toEqual([]);
  });
});

describe('checkUnitPolicy', () => {
  it('reports a commensurable unit that is not the one D4 binds the code to', () => {
    // LOINC 93832-4 is bound to `min`. Seconds under it is a factor of sixty in a
    // number that looks entirely reasonable either way.
    expect(LOINC_UNITS['93832-4']?.code).toBe('min');
    const issues = checkUnitPolicy(
      observation('93832-4', { value: 27180, unit: 'seconds', system: SYSTEMS.UCUM, code: 's' }),
      'Observation'
    );
    expect(issues.map((issue) => issue.rule)).toEqual(['ot-unit-policy']);
  });

  it('separates a scale error from a dimension error', () => {
    const dimension = checkUnitPolicy(
      observation('93832-4', { value: 62, unit: 'kilograms', system: SYSTEMS.UCUM, code: 'kg' }),
      'Observation'
    );
    expect(dimension.map((issue) => issue.rule)).toEqual(['ot-unit-dimension']);
  });

  it('accepts the unit the policy names', () => {
    expect(
      checkUnitPolicy(
        observation('93832-4', { value: 453, unit: 'minutes', system: SYSTEMS.UCUM, code: 'min' }),
        'Observation'
      )
    ).toEqual([]);
  });

  it('says nothing about a LOINC code the policy does not cover', () => {
    // 35200-5, cholesterol. `LOINC_UNITS` binds no unit to it, and inventing one
    // here would be this package deciding a clinical question on its own.
    expect(LOINC_UNITS['35200-5']).toBeUndefined();
    expect(
      checkUnitPolicy(
        observation('35200-5', { value: 6.3, unit: 'mmol/L', system: SYSTEMS.UCUM, code: 'mmol/L' }),
        'Observation'
      )
    ).toEqual([]);
  });

  it('checks components as well as the observation value', () => {
    const withComponent = {
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [{ system: SYSTEMS.OURA, code: 'sleep-summary' }] },
      component: [
        {
          code: { coding: [{ system: SYSTEMS.LOINC, code: '93831-6' }] },
          valueQuantity: { value: 4680, unit: 'seconds', system: SYSTEMS.UCUM, code: 's' }
        }
      ]
    };
    const issues = checkUnitPolicy(withComponent, 'Observation');
    expect(issues.map((issue) => issue.rule)).toEqual(['ot-unit-policy']);
    expect(issues[0]?.expression).toBe('Observation.component[0].valueQuantity.code');
  });

  it('reads through to the LOINC coding the policy covers when several are present', () => {
    // Observation-satO2 lists 2708-6 first and 59408-5 second; only the second is in
    // LOINC_UNITS. Stopping at the first coding would silently check nothing.
    expect(LOINC_UNITS['2708-6']).toBeUndefined();
    const multi = {
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [
          { system: SYSTEMS.LOINC, code: '2708-6' },
          { system: SYSTEMS.LOINC, code: '59408-5' }
        ]
      },
      valueQuantity: { value: 0.95, unit: 'ratio', system: SYSTEMS.UCUM, code: '1' }
    };
    expect(checkUnitPolicy(multi, 'Observation').map((issue) => issue.rule)).toEqual(['ot-unit-policy']);
  });

  it('never names the offending unit in the report', () => {
    const issues = checkUnitPolicy(
      observation('93832-4', { value: 27180, unit: 'MARKER-UNIT-4471', system: SYSTEMS.UCUM, code: 's' }),
      'Observation'
    );
    expect(JSON.stringify(issues)).not.toContain('MARKER-UNIT-4471');
  });
});
