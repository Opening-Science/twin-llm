/**
 * WHAT: Canonical FHIR and Foundation code-system URIs, profiles, and categories.
 * NOT:  Must not invent LOINC/SNOMED codes; only system URIs and shared category codings.
GOVERNED BY: DECISIONS.md#d3
 * CORRECTNESS: HL7 FHIR R4 published system URIs and Foundation-controlled opentwin.ch namespaces (D3).
 */
export const SYSTEMS = {
  /** HL7-maintained. */
  LOINC: 'http://loinc.org',
  SNOMED: 'http://snomed.info/sct',
  UCUM: 'http://unitsofmeasure.org',
  OBSERVATION_CATEGORY: 'http://terminology.hl7.org/CodeSystem/observation-category',
  DATA_ABSENT_REASON: 'http://terminology.hl7.org/CodeSystem/data-absent-reason',
  /** What question a reference interval answers — normal, recommended, treatment. */
  REFERENCE_RANGE_MEANING: 'http://terminology.hl7.org/CodeSystem/referencerange-meaning',

  /** Foundation-controlled. One namespace per connector (D3). */
  OURA: 'http://opentwin.ch/fhir/CodeSystem/oura',
  WHOOP: 'http://opentwin.ch/fhir/CodeSystem/whoop',
  GOOGLE_HEALTH: 'http://opentwin.ch/fhir/CodeSystem/google-health',
  VITRONIC: 'http://opentwin.ch/fhir/CodeSystem/vitronic',
  ANCHOR: 'http://opentwin.ch/fhir/CodeSystem/anchor',

  /**
   * How a value was arrived at — measured, device-estimated, derived from sleep, or
   * selected from several sources. R4 has no element for measurement provenance
   * beyond `Observation.method`, so this is the vocabulary that fills it.
   */
  METHOD: 'http://opentwin.ch/fhir/CodeSystem/method',

  /** Foundation-controlled identifier namespaces, reused as `Identifier.system` (D2). */
  OURA_IDENTIFIER: 'http://opentwin.ch/fhir/sid/oura',
  WHOOP_IDENTIFIER: 'http://opentwin.ch/fhir/sid/whoop',
  GOOGLE_HEALTH_IDENTIFIER: 'http://opentwin.ch/fhir/sid/google-health',
  VITRONIC_IDENTIFIER: 'http://opentwin.ch/fhir/sid/vitronic',
  ANCHOR_IDENTIFIER: 'http://opentwin.ch/fhir/sid/anchor'
} as const;

/**
 * FHIR R4 vital-signs profiles. These auto-apply whenever a recognised LOINC code
 * is emitted — the validator will enforce them whether or not they are declared —
 * so declaring them makes the contract explicit rather than adding an obligation.
 *
 * Note `valueQuantity.code` is *fixed* (not merely bound) on each of these:
 * heart rate and respiratory rate to `/min`, oxygen saturation to `%`.
 */
export const PROFILES = {
  VITAL_SIGNS: 'http://hl7.org/fhir/StructureDefinition/vitalsigns',
  HEART_RATE: 'http://hl7.org/fhir/StructureDefinition/heartrate',
  RESPIRATORY_RATE: 'http://hl7.org/fhir/StructureDefinition/resprate',
  OXYGEN_SATURATION: 'http://hl7.org/fhir/StructureDefinition/oxygensat',
  BODY_HEIGHT: 'http://hl7.org/fhir/StructureDefinition/bodyheight',
  BODY_WEIGHT: 'http://hl7.org/fhir/StructureDefinition/bodyweight',
  BODY_TEMPERATURE: 'http://hl7.org/fhir/StructureDefinition/bodytemp'
} as const;

export const CATEGORY = {
  VITAL_SIGNS: { code: 'vital-signs', display: 'Vital Signs' },
  ACTIVITY: { code: 'activity', display: 'Activity' },
  EXAM: { code: 'exam', display: 'Exam' },
  /** Anchor layer: clinical biomarkers from a laboratory. */
  LABORATORY: { code: 'laboratory', display: 'Laboratory' },
  SURVEY: { code: 'survey', display: 'Survey' }
} as const;

export type CategoryKey = keyof typeof CATEGORY;

/** Identifier namespace for a connector's own device identifiers. */
export function deviceIdentifierSystem(connector: string): string {
  return `http://opentwin.ch/fhir/sid/${connector}-device`;
}
