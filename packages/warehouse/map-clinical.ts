/**
 * Conditions and medication requests from a normalised Synthea bundle, as
 * rows for the warehouse. Pure. Values are copied as recorded: nothing is
 * inferred, a missing date or status stays null, and dosage is only the
 * `dosageInstruction[].text` the record carries, verbatim.
 */
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";

export type ConditionRow = Readonly<{
  fhirId: string;
  codeSystem: string;
  code: string;
  display: string;
  onsetAt: Date | null;
  abatementAt: Date | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  encounterRef: string | null;
}>;

export type MedicationRequestRow = Readonly<{
  fhirId: string;
  codeSystem: string;
  code: string;
  display: string;
  authoredAt: Date | null;
  status: string | null;
  intent: string | null;
  /** `dosageInstruction[].text`, verbatim and in order; empty when none has text. */
  dosageText: readonly string[];
  /** `reasonReference[].reference`, in order. */
  reasonRefs: readonly string[];
}>;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const array = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const dateOf = (value: unknown): Date | null => {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

type Coded = Readonly<{ codeSystem: string; code: string; display: string }>;

const NO_CODE: Coded = { codeSystem: "", code: "", display: "" };

/** The coding from `preferred` when there is one, else the first; display falls back to `text`. */
const codedOf = (concept: unknown, preferred?: string): Coded => {
  if (!isObject(concept)) return NO_CODE;
  const codings = array(concept.coding).filter(isObject);
  const coding =
    (preferred ? codings.find((item) => item.system === preferred) : undefined) ??
    codings[0];
  return {
    codeSystem: text(coding?.system) ?? "",
    code: text(coding?.code) ?? "",
    display: text(coding?.display) ?? text(concept.text) ?? "",
  };
};

const statusOf = (concept: unknown): string | null =>
  isObject(concept) ? text(array(concept.coding).filter(isObject)[0]?.code) : null;

const resourcesOf = (entries: readonly unknown[]): readonly Json[] =>
  entries.flatMap((entry) =>
    isObject(entry) && isObject(entry.resource) ? [entry.resource] : [],
  );

/** Every address a Medication in the bundle can be referenced by. */
const medicationIndex = (entries: readonly unknown[]): ReadonlyMap<string, Json> =>
  new Map(
    entries.flatMap((entry): [string, Json][] => {
      if (!isObject(entry) || !isObject(entry.resource)) return [];
      const resource = entry.resource;
      if (resource.resourceType !== "Medication") return [];
      const id = text(resource.id);
      const keys = [
        text(entry.fullUrl),
        id ? `Medication/${id}` : null,
        id ? `urn:uuid:${id}` : null,
      ].filter((key) => key !== null);
      return keys.map((key) => [key, resource]);
    }),
  );

export const mapConditions = (entries: readonly unknown[]): ConditionRow[] =>
  resourcesOf(entries).flatMap((resource) => {
    if (resource.resourceType !== "Condition") return [];
    const fhirId = text(resource.id);
    if (fhirId === null) return [];
    return [
      {
        fhirId,
        ...codedOf(resource.code),
        onsetAt: dateOf(resource.onsetDateTime),
        abatementAt: dateOf(resource.abatementDateTime),
        clinicalStatus: statusOf(resource.clinicalStatus),
        verificationStatus: statusOf(resource.verificationStatus),
        encounterRef: isObject(resource.encounter)
          ? text(resource.encounter.reference)
          : null,
      },
    ];
  });

/**
 * The medication is `medicationCodeableConcept`, or the `code` of the
 * Medication that `medicationReference` points at in the same bundle (Synthea
 * uses both). An RxNorm coding wins over any other.
 */
export const mapMedicationRequests = (
  entries: readonly unknown[],
): MedicationRequestRow[] => {
  const medications = medicationIndex(entries);
  return resourcesOf(entries).flatMap((resource) => {
    if (resource.resourceType !== "MedicationRequest") return [];
    const fhirId = text(resource.id);
    if (fhirId === null) return [];
    const reference = isObject(resource.medicationReference)
      ? text(resource.medicationReference.reference)
      : null;
    const concept =
      resource.medicationCodeableConcept ??
      (reference === null ? undefined : medications.get(reference)?.code);
    return [
      {
        fhirId,
        ...codedOf(concept, RXNORM),
        authoredAt: dateOf(resource.authoredOn),
        status: text(resource.status),
        intent: text(resource.intent),
        dosageText: array(resource.dosageInstruction).flatMap((dosage) => {
          const value = isObject(dosage) ? text(dosage.text) : null;
          return value === null ? [] : [value];
        }),
        reasonRefs: array(resource.reasonReference).flatMap((reason) => {
          const value = isObject(reason) ? text(reason.reference) : null;
          return value === null ? [] : [value];
        }),
      },
    ];
  });
};
