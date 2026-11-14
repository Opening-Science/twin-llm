import { SYSTEMS } from '@open-twin/fhir-core';
import { describe, expect, it } from 'vitest';
import { FHIR_ISSUE_RULES, type FhirIssueRule } from '../issues';
import { normaliseBundle } from '../normalise/normalise';
import { HL7_LIPIDS_BUNDLE } from '../samples/hl7-lipids-bundle';
import { HL7_VITALS_BUNDLE } from '../samples/hl7-vitals-bundle';
import { validateFhir } from '../validate/validate';
import { INVALID_FIXTURES } from './fixtures/invalid-bundles';

/**
 * One case per rule, and a check that no rule is left without one.
 *
 * `invalid-bundles.ts` covers the defects worth comparing against the HL7 validator.
 * This file covers the rest of the surface: the rules that fire on input too broken,
 * too small or too specific to be worth an oracle run. Between the two, every rule
 * the package can emit has at least one input that emits it — which is the only way
 * to tell a working rule from one that has never fired and never will.
 */

type Json = Record<string, unknown>;

const OBSERVATION_URN = 'urn:uuid:7f5c1a0e-4d63-4a2b-9c18-8e3b6f4a1d92';

const observation = (overrides: Json = {}): Json => ({
  resourceType: 'Observation',
  id: OBSERVATION_URN.slice(9),
  status: 'final',
  code: { coding: [{ system: SYSTEMS.LOINC, code: '8867-4' }] },
  valueQuantity: { value: 62, unit: 'per minute', system: SYSTEMS.UCUM, code: '/min' },
  ...overrides
});

const inBundle = (entries: Json[]): Json => ({ resourceType: 'Bundle', type: 'collection', entry: entries });

const CONNECTOR = { connector: 'fhir-r4', version: '0.1.0' };
const NORMALISE_OPTIONS = {
  connector: CONNECTOR,
  subjectKey: 'rule-coverage-subject',
  timestamp: '2026-07-26T10:00:00Z',
  bundleKey: 'rule-coverage'
};

interface RuleCase {
  rule: FhirIssueRule;
  why: string;
  run(): readonly { rule: FhirIssueRule }[];
}

const validating = (rule: FhirIssueRule, why: string, input: unknown): RuleCase => ({
  rule,
  why,
  run: () => validateFhir(input).issues
});

const normalising = (rule: FhirIssueRule, why: string, input: unknown, overrides: Json = {}): RuleCase => ({
  rule,
  why,
  run: () => normaliseBundle(input, { ...NORMALISE_OPTIONS, ...overrides }).issues
});

const CASES: readonly RuleCase[] = [
  validating('ot-not-an-object', 'a number is not a resource', 42),
  validating('ot-missing-resource-type', 'resourceType is not a string', { resourceType: 7 }),
  validating('ot-unknown-resource-type', 'Scan is not an R4 resource type', { resourceType: 'Scan' }),
  validating('ot-missing-required-element', 'Observation.code is min 1', {
    resourceType: 'Observation',
    status: 'final'
  }),
  validating(
    'ot-invalid-id',
    'Resource.id admits only A-Z a-z 0-9 hyphen and dot',
    observation({ id: 'not a valid id!' })
  ),
  validating('ot-invalid-bundle-type', 'Bundle.type has a required binding', {
    resourceType: 'Bundle',
    type: 'whatever'
  }),
  validating('ot-entry-not-an-object', 'a null entry cannot be read', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [null]
  }),
  validating('ot-entry-empty', 'bdl-5: an entry needs a resource, a request or a response', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ fullUrl: OBSERVATION_URN }]
  }),
  validating(
    'ot-fullurl-missing',
    'nothing can reference an entry with no fullUrl',
    inBundle([{ resource: observation() }])
  ),
  validating('ot-fullurl-relative', 'a relative fullUrl means nothing once the bundle moves', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ fullUrl: 'Observation/hr1', resource: observation() }]
  }),
  validating('ot-fullurl-uuid', 'urn:uuid: must carry a lowercase RFC 4122 UUID', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ fullUrl: 'urn:uuid:oura-activity-123', resource: observation() }]
  }),
  validating('ot-fullurl-oid', 'urn:oid: must carry an ISO object identifier', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ fullUrl: 'urn:oid:not-an-oid', resource: observation() }]
  }),
  validating('ot-fullurl-id-mismatch', 'a RESTful fullUrl must address what it carries', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ fullUrl: 'https://example.org/fhir/Observation/somebody-else', resource: observation() }]
  }),
  validating('bdl-7', 'two entries, one fullUrl, no versionId', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      { fullUrl: OBSERVATION_URN, resource: observation() },
      { fullUrl: OBSERVATION_URN, resource: observation() }
    ]
  }),
  validating('bdl-8', 'a version-specific fullUrl', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ fullUrl: 'https://example.org/fhir/Observation/hr1/_history/2', resource: observation() }]
  }),
  validating(
    'ot-reference-malformed',
    'neither a fragment, nor Type/id, nor an absolute URI',
    observation({ subject: { reference: 'whoever this is' } })
  ),
  validating(
    'ot-reference-unresolved-contained',
    '#id must name something in contained',
    observation({ subject: { reference: '#nobody' } })
  ),
  validating(
    'ot-reference-unresolved-urn',
    'a urn: reference resolves only against a fullUrl in the same bundle',
    inBundle([{ fullUrl: OBSERVATION_URN, resource: observation({ subject: { reference: 'urn:uuid:missing' } }) }])
  ),
  validating(
    'ot-reference-external',
    'a relative reference the bundle does not carry',
    inBundle([{ fullUrl: OBSERVATION_URN, resource: observation({ subject: { reference: 'Patient/elsewhere' } }) }])
  ),
  validating('ot-reference-conditional', 'a search URI, which only a transaction may carry', {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        fullUrl: OBSERVATION_URN,
        resource: observation({ subject: { reference: 'Patient?identifier=https://example.org/mrn|12345' } }),
        request: { method: 'POST', url: 'Observation' }
      }
    ]
  }),
  validating('obs-6', 'a value and a reason there is no value', observation({ dataAbsentReason: { coding: [] } })),
  validating('ot-choice-type', 'two spellings of value[x]', observation({ valueString: 'sixty two' })),
  validating(
    'ot-component-data-absent-reason',
    'the same contradiction on a component, which R4 states no invariant about',
    observation({
      component: [
        {
          code: { coding: [{ system: SYSTEMS.LOINC, code: '8867-4' }] },
          valueQuantity: { value: 62, unit: 'per minute', system: SYSTEMS.UCUM, code: '/min' },
          dataAbsentReason: { coding: [] }
        }
      ]
    })
  ),
  validating(
    'ot-quantity-no-code',
    'the UCUM system with no code at all',
    observation({ valueQuantity: { value: 62, system: SYSTEMS.UCUM } })
  ),
  validating(
    'ot-quantity-no-system',
    'a unit that is a label and nothing more',
    observation({ valueQuantity: { value: 62, unit: 'per minute' } })
  ),
  validating(
    'ot-ucum-invalid',
    'bare steps is not a UCUM symbol',
    observation({ valueQuantity: { value: 8214, unit: 'steps', system: SYSTEMS.UCUM, code: 'steps' } })
  ),
  validating(
    'ot-unit-policy',
    'seconds under a code D4 binds to minutes',
    observation({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93832-4' }] },
      valueQuantity: { value: 27180, unit: 'seconds', system: SYSTEMS.UCUM, code: 's' }
    })
  ),
  validating(
    'ot-unit-dimension',
    'kilograms under a duration code',
    observation({
      code: { coding: [{ system: SYSTEMS.LOINC, code: '93832-4' }] },
      valueQuantity: { value: 62, unit: 'kilograms', system: SYSTEMS.UCUM, code: 'kg' }
    })
  ),
  normalising('ot-normalised-subject', 'D1 repoints a subject that was there', HL7_VITALS_BUNDLE),
  normalising(
    'ot-normalised-subject-missing',
    'no subject is invented for a resource that never had one',
    inBundle([{ fullUrl: OBSERVATION_URN, resource: observation() }])
  ),
  normalising('ot-normalised-narrative-dropped', 'the narrative is stale by construction', HL7_LIPIDS_BUNDLE),
  normalising('ot-reference-ambiguous', 'the same relative address on two servers without a resolvable entry base', {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        fullUrl: 'https://a.example/fhir/Patient/p',
        resource: { resourceType: 'Patient', id: 'p' }
      },
      {
        fullUrl: 'urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        resource: {
          resourceType: 'Observation',
          id: 'o',
          status: 'final',
          code: {},
          performer: [{ reference: 'Patient/p' }]
        }
      },
      {
        fullUrl: 'https://b.example/fhir/Patient/p',
        resource: { resourceType: 'Patient', id: 'p' }
      }
    ]
  }),
  normalising(
    'ot-normalised-patient-orphaned',
    'a Patient nothing points at any more',
    inBundle([{ fullUrl: 'https://example.org/fhir/Patient/pat2', resource: { resourceType: 'Patient', id: 'pat2' } }]),
    { subject: { reference: 'Patient/12345' } }
  ),
  normalising('ot-normalised-subject-external', 'a caller-supplied subject outside the bundle', HL7_VITALS_BUNDLE, {
    subject: { reference: 'Patient/12345' }
  })
];

describe('rule coverage', () => {
  it.each(CASES)('$rule: $why', (testCase) => {
    expect(testCase.run().map((item) => item.rule)).toContain(testCase.rule);
  });

  it('leaves no declared rule without an input that produces it', () => {
    const produced = new Set<string>([
      ...CASES.flatMap((testCase) => testCase.run().map((item) => item.rule)),
      ...INVALID_FIXTURES.flatMap((fixture) => validateFhir(fixture.bundle).issues.map((item) => item.rule))
    ]);
    const unreachable = FHIR_ISSUE_RULES.filter((rule) => !produced.has(rule));

    expect(unreachable).toEqual([]);
  });

  it('declares every rule it produces', () => {
    // The other direction. A rule emitted but not declared would type-check only
    // through a cast, and would be invisible to the coverage check above.
    const declared = new Set<string>(FHIR_ISSUE_RULES);
    const produced = CASES.flatMap((testCase) => testCase.run().map((item) => item.rule));

    expect(produced.filter((rule) => !declared.has(rule))).toEqual([]);
  });
});
