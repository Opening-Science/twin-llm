/**
 * WHAT: Package public barrel: re-exports the supported API surface.
 * NOT:  Must not contain mapping or clinical logic; implementation lives in sibling modules.
GOVERNED BY: DECISIONS.md#d9
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
export { FHIR_ISSUE_RULES, type FhirIssue, type FhirIssueRule, hasErrors, issue, toOutcome } from './issues';
export { type NormaliseOptions, type NormaliseResult, normaliseBundle } from './normalise/normalise';
export { HL7_BODY_HEIGHT_BUNDLE } from './samples/hl7-body-height-bundle';
export { HL7_LIPIDS_BUNDLE } from './samples/hl7-lipids-bundle';
export { HL7_VITALS_BUNDLE } from './samples/hl7-vitals-bundle';
export { checkUcumCodes, checkUnitPolicy } from './units/check';
export { areCommensurable, isValidUcum } from './units/ucum';
export { BUNDLE_TYPES } from './validate/structure';
export { type ValidationOptions, type ValidationResult, validateFhir } from './validate/validate';
export { fhirR4IngestBundle } from './verification/exampleBundle';
