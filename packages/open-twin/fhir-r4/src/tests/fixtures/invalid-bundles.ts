import { SYSTEMS } from '@open-twin/fhir-core';
import type { FhirIssue, FhirIssueRule } from '../../issues';
import { HL7_BODY_HEIGHT_BUNDLE } from '../../samples/hl7-body-height-bundle';

/**
 * Deliberately broken bundles, one defect each.
 *
 * Every fixture is derived from the same base, so the only thing that can explain a
 * difference in the report is the single mutation the fixture names. A fixture that
 * breaks two things at once cannot tell you which check caught it.
 *
 * The base is a conformant heart-rate Observation — category, subject and
 * `effective[x]` included — beside the Patient it points at, so the reference
 * validator has nothing to complain about except the defect under test. Without
 * those elements every fixture would fail the oracle for reasons that have nothing
 * to do with what it is testing, and the comparison would be worthless.
 *
 * `severity` and `hl7` are both recorded, and they are different claims. The first
 * is what this package must report and is asserted directly. The second is what the
 * HL7 reference validator said when it was last run over the same bundle, recorded
 * in `src/tests/oracle/oracle-verdicts.json` — where the two disagree, the
 * disagreement is written down and defended rather than argued about.
 */
export interface InvalidFixture {
  name: string;
  /** What is wrong with it, in one line. */
  defect: string;
  /** The rule this package must report. */
  rule: FhirIssueRule;
  /** The severity this package must report that rule at. */
  severity: FhirIssue['severity'];
  /**
   * What the HL7 reference validator makes of the same bundle:
   *
   *  - `error`    it reports at least one error too, and this package agrees with it
   *  - `clean`    it reports none, and it is right: the resource is conformant FHIR
   *               and the finding here is open-twin policy rather than an HL7 rule
   *  - `abstains` it cannot answer, because `-tx n/a` leaves it with no terminology
   *               server for the value set involved
   */
  hl7: 'error' | 'clean' | 'abstains';
  /** Required whenever `hl7` is not `error`: why the validator says nothing. */
  hl7Note?: string;
  bundle: unknown;
}

const PATIENT_URN = 'urn:uuid:2b90dd2b-1a3f-4c5e-9a71-6d0a1f2e3b40';
const OBSERVATION_URN = 'urn:uuid:7f5c1a0e-4d63-4a2b-9c18-8e3b6f4a1d92';
const SECOND_OBSERVATION_URN = 'urn:uuid:0a1d4c7e-9b32-4f58-8d6a-2c5e7b9f0a13';

type Json = Record<string, unknown>;

const category = (code: string, display: string): Json => ({
  coding: [{ system: SYSTEMS.OBSERVATION_CATEGORY, code, display }]
});

function patientEntry(): Json {
  return { fullUrl: PATIENT_URN, resource: { resourceType: 'Patient', id: PATIENT_URN.slice(9) } };
}

/** Heart rate, 62 /min: the unit `LOINC_UNITS` binds LOINC 8867-4 to. */
function observation(overrides: Json = {}): Json {
  return {
    resourceType: 'Observation',
    id: OBSERVATION_URN.slice(9),
    status: 'final',
    category: [category('vital-signs', 'Vital Signs')],
    code: { coding: [{ system: SYSTEMS.LOINC, code: '8867-4', display: 'Heart rate' }] },
    subject: { reference: PATIENT_URN },
    effectiveDateTime: '2026-07-26T09:30:00+02:00',
    valueQuantity: { value: 62, unit: 'per minute', system: SYSTEMS.UCUM, code: '/min' },
    ...overrides
  };
}

function bundle(entries: Json[]): Json {
  return { resourceType: 'Bundle', type: 'collection', entry: entries };
}

function base(overrides: Json = {}, entryOverrides: Json = {}): Json {
  return bundle([patientEntry(), { fullUrl: OBSERVATION_URN, resource: observation(overrides), ...entryOverrides }]);
}

export const VALID_BASELINE: unknown = base();

/** Non-vital measures, so no vital-signs profile applies and the unit is the only variable. */
const ACTIVITY = [category('activity', 'Activity')];

export const INVALID_FIXTURES: readonly InvalidFixture[] = [
  {
    name: 'fullurl-not-a-uuid',
    defect: 'entry.fullUrl uses the urn:uuid: scheme but carries a human-readable id',
    rule: 'ot-fullurl-uuid',
    severity: 'error',
    hl7: 'error',
    bundle: base({}, { fullUrl: 'urn:uuid:oura-activity-123' })
  },
  {
    name: 'fullurl-uppercase-uuid',
    defect: 'entry.fullUrl carries a well-formed UUID in upper case',
    rule: 'ot-fullurl-uuid',
    severity: 'error',
    hl7: 'error',
    bundle: base({}, { fullUrl: `urn:uuid:${OBSERVATION_URN.slice(9).toUpperCase()}` })
  },
  {
    name: 'fullurl-duplicate',
    defect: 'two entries share one fullUrl with no distinguishing meta.versionId',
    rule: 'bdl-7',
    severity: 'error',
    hl7: 'error',
    bundle: bundle([
      patientEntry(),
      { fullUrl: OBSERVATION_URN, resource: observation() },
      { fullUrl: OBSERVATION_URN, resource: observation({ id: SECOND_OBSERVATION_URN.slice(9) }) }
    ])
  },
  {
    name: 'fullurl-version-specific',
    defect: 'entry.fullUrl is version specific, which bdl-8 forbids',
    rule: 'bdl-8',
    severity: 'error',
    hl7: 'error',
    bundle: base({}, { fullUrl: 'https://example.org/fhir/Observation/hr1/_history/2' })
  },
  {
    name: 'fullurl-addresses-another-resource',
    defect: 'a RESTful entry.fullUrl whose trailing id is not the id of the resource it carries',
    rule: 'ot-fullurl-id-mismatch',
    severity: 'error',
    hl7: 'error',
    bundle: base({}, { fullUrl: 'https://example.org/fhir/Observation/some-other-observation' })
  },
  {
    name: 'fullurl-relative',
    defect: 'entry.fullUrl is a relative URL',
    rule: 'ot-fullurl-relative',
    severity: 'error',
    hl7: 'error',
    bundle: base({}, { fullUrl: 'Observation/hr1' })
  },
  {
    name: 'obs-6-value-and-data-absent-reason',
    defect: 'the Observation states a value and simultaneously states that the value is absent',
    rule: 'obs-6',
    severity: 'error',
    hl7: 'error',
    bundle: base({
      dataAbsentReason: { coding: [{ system: SYSTEMS.DATA_ABSENT_REASON, code: 'unknown', display: 'Unknown' }] }
    })
  },
  {
    name: 'observation-two-values',
    defect: 'value[x] is a choice element and two of its spellings are present',
    rule: 'ot-choice-type',
    severity: 'error',
    hl7: 'error',
    bundle: base({ valueString: 'sixty two' })
  },
  {
    name: 'observation-missing-status',
    defect: 'Observation.status is declared min 1 by the base R4 definition',
    rule: 'ot-missing-required-element',
    severity: 'error',
    hl7: 'error',
    bundle: base({ status: undefined })
  },
  {
    name: 'unknown-resource-type',
    defect: 'the entry declares a resourceType FHIR R4 does not define',
    rule: 'ot-unknown-resource-type',
    severity: 'fatal',
    hl7: 'error',
    bundle: bundle([patientEntry(), { fullUrl: OBSERVATION_URN, resource: { ...observation(), resourceType: 'Scan' } }])
  },
  {
    name: 'dangling-urn-reference',
    defect: 'subject points at a urn:uuid: that no entry in the bundle carries',
    rule: 'ot-reference-unresolved-urn',
    // A warning, and not this package's judgement: the HL7 validator reports exactly
    // one line for it, at warning level, and where the two disagree the validator is
    // right. `normaliseBundle` treats the same finding as blocking, because it
    // rewrites every reference and cannot rewrite one that points nowhere.
    severity: 'warning',
    hl7: 'clean',
    hl7Note:
      'The validator reports it as a warning, not an error, so its recorded error list is empty. A collection bundle is allowed to carry references it does not resolve; this one cannot be resolved by anybody, anywhere, which is why it is still reported.',
    bundle: bundle([{ fullUrl: OBSERVATION_URN, resource: observation() }])
  },
  {
    name: 'ucum-bare-steps',
    defect: "the unit code is 'steps', which is not UCUM; countable things are annotations",
    rule: 'ot-ucum-invalid',
    severity: 'error',
    hl7: 'abstains',
    hl7Note:
      '`-tx n/a` leaves the validator with no terminology server, so it does not check the UCUM code at all. "The HL7 validator passed it" therefore says nothing whatsoever about the unit, which is the whole argument for parsing UCUM at runtime.',
    bundle: base({
      category: ACTIVITY,
      code: { coding: [{ system: SYSTEMS.LOINC, code: '55423-8', display: 'Number of steps' }] },
      valueQuantity: { value: 8214, unit: 'steps', system: SYSTEMS.UCUM, code: 'steps' }
    })
  },
  {
    name: 'unit-policy-seconds-under-a-minutes-code',
    defect: 'sleep duration in seconds under LOINC 93832-4, which D4 binds to minutes',
    rule: 'ot-unit-policy',
    severity: 'error',
    hl7: 'clean',
    hl7Note:
      'Valid UCUM, valid FHIR, no profile applies. The validator has nothing to say and is right to say nothing; a factor of sixty still lands in the record, under a code that says minutes.',
    bundle: base({
      category: ACTIVITY,
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93832-4', display: 'Sleep duration' }] },
      valueQuantity: { value: 27180, unit: 'seconds', system: SYSTEMS.UCUM, code: 's' }
    })
  },
  {
    name: 'unit-policy-height-in-inches',
    defect: 'body height in inches under LOINC 8302-2, which D4 binds to centimetres',
    rule: 'ot-unit-policy',
    severity: 'error',
    hl7: 'clean',
    hl7Note:
      'The sharpest case in the set. `[in_i]` is inside the *required* binding of the HL7 bodyheight profile, so the validator passes it — correctly. D4 still binds 8302-2 to `cm` alone, because a height in inches from one connector and a height in centimetres from another do not compare, and comparability is the entire premise of this project.',
    // HL7's own published example, verbatim. Nobody wrote this to lose an argument.
    bundle: HL7_BODY_HEIGHT_BUNDLE
  },
  {
    name: 'unit-dimension-mismatch',
    defect: 'a sleep duration expressed in kilograms',
    rule: 'ot-unit-dimension',
    severity: 'error',
    hl7: 'clean',
    hl7Note:
      'Also valid UCUM and valid FHIR. It is separated from the case above because the two fail differently: a scale error survives a plausibility check and a dimension error does not, and a receiver deserves to be told which one it is looking at.',
    bundle: base({
      category: ACTIVITY,
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93832-4', display: 'Sleep duration' }] },
      valueQuantity: { value: 62, unit: 'kilograms', system: SYSTEMS.UCUM, code: 'kg' }
    })
  },
  {
    name: 'quantity-without-a-system',
    defect: 'a Quantity with a human-readable unit and nothing machine-readable',
    rule: 'ot-quantity-no-system',
    // A warning: `Quantity.system` is optional in R4 and the resource is conformant.
    // It is reported because a unit no machine can read is how a duration in seconds
    // and a duration in minutes become the same document.
    severity: 'warning',
    hl7: 'clean',
    hl7Note:
      'Quantity.system is 0..1 in R4, so a Quantity carrying only a human-readable unit is conformant and the validator passes it. Nothing downstream can tell that unit from any other string.',
    bundle: base({
      category: ACTIVITY,
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93832-4', display: 'Sleep duration' }] },
      valueQuantity: { value: 453, unit: 'minutes' }
    })
  }
];
