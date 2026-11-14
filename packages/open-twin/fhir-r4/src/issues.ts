/**
 * WHAT: Issue helpers for FHIR validation/normalisation outcomes.
 * NOT:  Must not carry payload bodies.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { OperationOutcome, OperationOutcomeIssue } from 'fhir/r4';

/**
 * One finding, located by a FHIRPath expression rather than by quoting the input.
 *
 * Nothing in `message` or `expression` is ever copied out of the resource under
 * validation. That is not tidiness: an ingest package sees other people's records,
 * and a validation report is exactly the artefact that ends up in a log file, a CI
 * annotation or a bug tracker. `expression` is enough to find the element for anyone
 * who already holds the bundle, and useless to anyone who does not.
 *
 * The same discipline is why zod's own issue messages are discarded here — zod
 * interpolates the received value into `invalid_type` messages.
 */
export interface FhirIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  /** The FHIR issue-type code, so a receiver can act without parsing prose. */
  code: OperationOutcomeIssue['code'];
  /**
   * Stable rule identifier. FHIR invariant keys (`obs-6`, `bdl-7`) where one
   * applies; otherwise `ot-*` for a rule this package defines.
   */
  rule: FhirIssueRule;
  /** FHIRPath locating the element, e.g. `Bundle.entry[3].fullUrl`. */
  expression: string;
  /** Explains the rule. Contains no data from the input. */
  message: string;
}

/**
 * Every rule this package can report, as a value and not only as a type.
 *
 * A union type cannot be enumerated at runtime, and a rule that no input can
 * actually produce is indistinguishable from one that works until somebody needs it.
 * `src/tests/rules.unit.test.ts` walks this list and fails on any entry no case in
 * the suite provokes, so adding a rule here without a test that fires it is a red
 * run rather than a quiet gap.
 */
export const FHIR_ISSUE_RULES = [
  // FHIR invariants, keyed as the specification keys them.
  'obs-6',
  'bdl-7',
  'bdl-8',
  // Rules this package defines. `ot-` marks them as open-twin's, not HL7's.
  'ot-not-an-object',
  'ot-missing-resource-type',
  'ot-unknown-resource-type',
  'ot-missing-required-element',
  'ot-invalid-id',
  'ot-invalid-bundle-type',
  'ot-entry-not-an-object',
  'ot-entry-empty',
  'ot-fullurl-missing',
  'ot-fullurl-relative',
  'ot-fullurl-uuid',
  'ot-fullurl-oid',
  'ot-fullurl-id-mismatch',
  'ot-reference-malformed',
  'ot-reference-ambiguous',
  'ot-reference-unresolved-urn',
  'ot-reference-unresolved-contained',
  'ot-reference-external',
  'ot-reference-conditional',
  'ot-choice-type',
  'ot-component-data-absent-reason',
  'ot-quantity-no-code',
  'ot-quantity-no-system',
  'ot-ucum-invalid',
  'ot-unit-policy',
  'ot-unit-dimension',
  'ot-normalised-subject',
  'ot-normalised-subject-missing',
  'ot-normalised-narrative-dropped',
  'ot-normalised-patient-orphaned',
  'ot-normalised-subject-external'
] as const;

export type FhirIssueRule = (typeof FHIR_ISSUE_RULES)[number];

export function issue(
  severity: FhirIssue['severity'],
  code: FhirIssue['code'],
  rule: FhirIssueRule,
  expression: string,
  message: string
): FhirIssue {
  return { severity, code, rule, expression, message };
}

export function hasErrors(issues: readonly FhirIssue[]): boolean {
  return issues.some((item) => item.severity === 'error' || item.severity === 'fatal');
}

/**
 * `OperationOutcome.issue` has a minimum cardinality of 1, so a clean result is a
 * single informational issue rather than an empty list — the same convention the
 * HL7 reference validator uses. Returning `undefined` for "no problems" would make
 * the success case structurally different from the failure case and push a
 * null-check onto every caller.
 */
export function toOutcome(issues: readonly FhirIssue[]): OperationOutcome {
  if (issues.length === 0) {
    return {
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'information',
          code: 'informational',
          details: { text: 'No issues detected.' }
        }
      ]
    };
  }

  const outcomeIssues: OperationOutcomeIssue[] = issues.map((item) => ({
    severity: item.severity,
    code: item.code,
    details: { text: item.message },
    // The rule id rides in `diagnostics` rather than in `details.coding`, because a
    // Coding needs a code system and open-twin does not get to invent one that is
    // not declared in verify/conformance/declarations.json.
    diagnostics: item.rule,
    expression: [item.expression]
  }));

  return { resourceType: 'OperationOutcome', issue: outcomeIssues };
}
