/**
 * WHAT: Validates or normalises foreign FHIR R4 Bundles structurally.
 * NOT:  Must not rewrite clinical codes or units to pass gates.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: HL7 FHIR R4 structure rules (local checks); CI also runs official validator on emitted exemplars.
 */
import { type FhirIssue, issue } from '../issues';
import { isObject, type JsonObject, presentValueElements } from './walk';

/**
 * FHIR R4 invariant **obs-6**, verbatim:
 *
 *   "dataAbsentReason SHALL only be present if Observation.value[x] is not present"
 *
 * It matters more than it looks. `dataAbsentReason` beside a value is how a resource
 * says two contradictory things at once — here is the measurement, and there is no
 * measurement — and a receiver is free to believe either. The counterpart mistake is
 * the one D-level decision this repository already records: a missing score written
 * as `score ?? 0`, which publishes the worst possible value on a 0-100 scale and is
 * indistinguishable from a real zero. obs-6 is what makes the honest option
 * expressible.
 */
export function checkObservation(observation: JsonObject, path: string): FhirIssue[] {
  const issues: FhirIssue[] = [];

  const values = presentValueElements(observation);
  if (values.length > 1) {
    issues.push(
      issue(
        'error',
        'structure',
        'ot-choice-type',
        `${path}.value[x]`,
        'Observation.value[x] is a choice element: at most one of its typed spellings may be present.'
      )
    );
  }

  if (values.length > 0 && observation.dataAbsentReason !== undefined) {
    issues.push(
      issue(
        'error',
        'invariant',
        'obs-6',
        `${path}.dataAbsentReason`,
        'FHIR invariant obs-6: dataAbsentReason SHALL only be present if Observation.value[x] is not present.'
      )
    );
  }

  const components = Array.isArray(observation.component) ? observation.component : [];
  for (const [index, raw] of components.entries()) {
    if (!isObject(raw)) continue;
    const componentPath = `${path}.component[${index}]`;
    const componentValues = presentValueElements(raw);

    if (componentValues.length > 1) {
      issues.push(
        issue(
          'error',
          'structure',
          'ot-choice-type',
          `${componentPath}.value[x]`,
          'Observation.component.value[x] is a choice element: at most one of its typed spellings may be present.'
        )
      );
    }

    if (componentValues.length > 0 && raw.dataAbsentReason !== undefined) {
      // Reported as a warning, not as obs-6, and deliberately so: R4 states obs-6
      // only on Observation itself and declares no equivalent invariant on
      // Observation.component, so the HL7 validator does not flag this. Claiming
      // otherwise would be inventing a rule and attributing it to HL7. The
      // contradiction is real all the same, which is why it is not silent.
      issues.push(
        issue(
          'warning',
          'business-rule',
          'ot-component-data-absent-reason',
          `${componentPath}.dataAbsentReason`,
          'This component states both a value and a reason the value is absent. R4 declares no invariant here, but a receiver has no way to choose between them.'
        )
      );
    }
  }

  return issues;
}
