import { describe, expect, it } from 'vitest';
import { validateFhir } from '../validate/validate';
import { fhirR4IngestBundle } from '../verification/exampleBundle';
import { INVALID_FIXTURES, VALID_BASELINE } from './fixtures/invalid-bundles';
import ORACLE from './oracle/oracle-verdicts.json';

/**
 * The HL7 reference validator is the authority; this package is not.
 *
 * These tests compare the two over the same fixtures, using output recorded by
 * `tools/hl7-oracle.ts` from a real validator run rather than from anybody's
 * expectations. A validator run takes twelve seconds of package loading and needs a
 * JVM and a 187 MB jar, so it does not belong in a unit-test suite — but the
 * recording does, because it is the only thing that keeps this package's opinions
 * anchored to something outside itself.
 *
 * Regenerate with:
 *   OT_HL7_VALIDATOR_JAR=/path/to/validator_cli.jar pnpm --filter @open-twin/fhir-r4 oracle
 */
const verdicts: Record<string, { errors: string[] }> = ORACLE.verdicts;

const errorsFor = (name: string): string[] => {
  const verdict = verdicts[name];
  if (!verdict) throw new Error(`no recorded HL7 verdict for '${name}'. Re-run the oracle.`);
  return verdict.errors;
};

describe('agreement with the HL7 validator', () => {
  it('has a recorded verdict for every fixture, so nothing is compared against a gap', () => {
    const expected = ['valid-baseline', 'normalised-hl7-vitals', ...INVALID_FIXTURES.map((f) => f.name)];
    expect(Object.keys(verdicts)).toEqual(expect.arrayContaining(expected));
  });

  it('agrees the conformant baseline is conformant', () => {
    expect(errorsFor('valid-baseline')).toEqual([]);
    expect(validateFhir(VALID_BASELINE).ok).toBe(true);
  });

  it('agrees the registered bundle is conformant', () => {
    expect(errorsFor('normalised-hl7-vitals')).toEqual([]);
    expect(validateFhir(fhirR4IngestBundle()).ok).toBe(true);
  });

  const agreeing = INVALID_FIXTURES.filter((fixture) => fixture.hl7 === 'error');

  it.each(agreeing)('$name: the validator errors on it too', (fixture) => {
    expect(errorsFor(fixture.name).length).toBeGreaterThan(0);
    expect(validateFhir(fixture.bundle).ok).toBe(false);
  });

  /**
   * The disagreements, asserted rather than described.
   *
   * Every one of them is a unit finding, and in every one the validator is right
   * that the resource is conformant FHIR — which is why the recorded error list must
   * be empty for the test to pass. What is being asserted is not that the validator
   * is wrong; it is that the two are answering different questions, and that this
   * package's extra question is worth asking. If a future change to the validator
   * starts reporting one of these, this test goes red and somebody has to look.
   */
  const disagreeing = INVALID_FIXTURES.filter((fixture) => fixture.hl7 !== 'error');

  it.each(disagreeing)('$name: this package reports it and the validator does not', (fixture) => {
    expect(errorsFor(fixture.name)).toEqual([]);
    const issues = validateFhir(fixture.bundle).issues.filter((item) => item.rule === fixture.rule);
    expect(issues.length).toBeGreaterThan(0);
    expect(fixture.hl7Note, `${fixture.name} must record why the validator says nothing`).toBeTruthy();
  });

  it('records exactly one case where the validator abstains for want of a terminology server', () => {
    // Being specific matters. `-tx n/a` means UCUM codes are not checked at all, so
    // "the HL7 validator passed it" says nothing whatsoever about the unit — which
    // is the whole argument for checking units at runtime.
    const abstained = INVALID_FIXTURES.filter((fixture) => fixture.hl7 === 'abstains');
    expect(abstained.map((fixture) => fixture.name)).toEqual(['ucum-bare-steps']);
  });
});
