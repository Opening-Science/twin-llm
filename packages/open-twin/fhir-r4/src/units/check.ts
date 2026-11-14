/**
 * WHAT: UCUM validation / quantity helpers for this package.
 * NOT:  Must not invent unit codes; invalid UCUM fails closed.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: UCUM grammar via @lhncbc/ucum-lhc.
 */
import { LOINC_UNITS, SYSTEMS, type UcumUnit } from '@open-twin/fhir-core';
import { type FhirIssue, issue } from '../issues';
import { isObject, type JsonObject, walkObjects } from '../validate/walk';
import { areCommensurable, isValidUcum } from './ucum';

/**
 * Every UCUM-coded unit in the resource, checked against the published grammar.
 *
 * This runs over *arriving* data, which is what makes it different from
 * `verify/check-units.mjs`. That gate reads open-twin's own source and can only see
 * unit codes written as string literals; it cannot see a unit that a foreign system
 * put in a bundle, and it cannot see one that this repository's code passes through
 * unchanged. Those are precisely the units an ingest package meets.
 */
export function checkUcumCodes(root: JsonObject, path: string): FhirIssue[] {
  const issues: FhirIssue[] = [];

  for (const { node, path: nodePath } of walkObjects(root, path)) {
    if (node.resourceType !== undefined) continue;

    if (node.system === SYSTEMS.UCUM) {
      if (typeof node.code !== 'string' || node.code.length === 0) {
        issues.push(
          issue(
            'error',
            'value',
            'ot-quantity-no-code',
            `${nodePath}.code`,
            'This element declares the UCUM system but carries no unit code, so the number attached to it cannot be interpreted.'
          )
        );
        continue;
      }
      if (!isValidUcum(node.code)) {
        issues.push(
          issue(
            'error',
            'value',
            'ot-ucum-invalid',
            `${nodePath}.code`,
            'The unit code does not parse under the UCUM grammar. Countable things are expressed as annotations in braces, e.g. {steps}.'
          )
        );
      }
      continue;
    }

    // A Quantity that never declared a system: a number with a human-readable label
    // and nothing machine-readable. This is how a duration in seconds and a duration
    // in minutes become indistinguishable to a receiver.
    if (node.system === undefined && typeof node.value === 'number' && typeof node.unit === 'string') {
      issues.push(
        issue(
          'warning',
          'incomplete',
          'ot-quantity-no-system',
          `${nodePath}.system`,
          `This Quantity carries a unit but no system, so the unit is a human-readable label only. Set system to ${SYSTEMS.UCUM}.`
        )
      );
    }
  }

  return issues;
}

interface PolicySite {
  /** The CodeableConcept that names the concept being measured. */
  code: unknown;
  /** The Quantity carrying the measurement. */
  quantity: unknown;
  path: string;
}

/**
 * Decision D4: one unit per concept.
 *
 * `LOINC_UNITS` binds a LOINC code to exactly one UCUM code across every connector.
 * Where an arriving Observation carries a LOINC code that table covers and a
 * different unit, that is reported — even when the unit is impeccable UCUM and the
 * resource is perfectly valid FHIR. It has to be, because the failure this guards
 * against leaves no structural trace: the same LOINC code arriving from two sources
 * with two units merges into one patient record as two contradictory numbers.
 *
 * This is open-twin policy, not an HL7 rule, and the HL7 validator will not agree
 * that anything is wrong. Both statements are true at once.
 */
export function checkUnitPolicy(observation: JsonObject, path: string): FhirIssue[] {
  const sites: PolicySite[] = [{ code: observation.code, quantity: observation.valueQuantity, path }];

  const components = Array.isArray(observation.component) ? observation.component : [];
  for (const [index, component] of components.entries()) {
    if (!isObject(component)) continue;
    sites.push({
      code: component.code,
      quantity: component.valueQuantity,
      path: `${path}.component[${index}]`
    });
  }

  const issues: FhirIssue[] = [];
  for (const site of sites) {
    const policy = policyFor(site.code);
    if (!policy) continue;
    if (!isObject(site.quantity)) continue;
    if (site.quantity.system !== SYSTEMS.UCUM) continue;
    const actual = site.quantity.code;
    if (typeof actual !== 'string' || actual === policy.unit.code) continue;

    const commensurable = areCommensurable(actual, policy.unit.code);
    issues.push(
      commensurable
        ? issue(
            'error',
            'business-rule',
            'ot-unit-policy',
            `${site.path}.valueQuantity.code`,
            `Decision D4 binds this LOINC code to a single unit across all connectors (${policy.unit.code}, "${policy.unit.unit}"). The unit here measures the same quantity on a different scale, so the number will not compare with data from any other source without conversion.`
          )
        : issue(
            'error',
            'business-rule',
            'ot-unit-dimension',
            `${site.path}.valueQuantity.code`,
            `Decision D4 binds this LOINC code to ${policy.unit.code} ("${policy.unit.unit}"). The unit here is not commensurable with it, so this is a mapping error rather than a scale error.`
          )
    );
  }

  return issues;
}

interface Policy {
  loinc: string;
  unit: UcumUnit;
}

/**
 * The first LOINC coding the shared policy covers. An Observation may legitimately
 * carry several codings (a LOINC code and a vendor code for the same concept), and
 * only the LOINC one is bound.
 */
function policyFor(codeableConcept: unknown): Policy | undefined {
  if (!isObject(codeableConcept)) return undefined;
  const codings = Array.isArray(codeableConcept.coding) ? codeableConcept.coding : [];
  for (const coding of codings) {
    if (!isObject(coding)) continue;
    if (coding.system !== SYSTEMS.LOINC) continue;
    if (typeof coding.code !== 'string') continue;
    const unit = LOINC_UNITS[coding.code];
    if (unit) return { loinc: coding.code, unit };
  }
  return undefined;
}
