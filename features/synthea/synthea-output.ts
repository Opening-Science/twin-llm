/**
 * Reading what a Synthea run printed and wrote: the progress lines on stdout
 * and a short summary of one generated person for the page. Pure, so the
 * runner passes text and parsed JSON in and tests do the same.
 */

/** Synthea prints `12 -- Name (43 y/o F) City, State …` once per person. */
const PERSON_LINE = /^\s*(\d+) -- /;

/** The person number on a progress line, or null for any other line. */
export const progressFromLine = (line: string): number | null => {
  const match = PERSON_LINE.exec(line);
  return match ? Number(match[1]) : null;
};

/** The highest person number in a chunk of stdout, or null when there is none. */
export const progressFromChunk = (chunk: string): number | null =>
  chunk
    .split(/\r?\n/)
    .map(progressFromLine)
    .reduce<number | null>(
      (best, value) => (value === null ? best : Math.max(best ?? 0, value)),
      null,
    );

export type PreviewLine = Readonly<{ label: string; detail: string }>;

export type PatientPreview = Readonly<{
  sex: string;
  birthDate: string | null;
  deceasedDate: string | null;
  counts: Readonly<{
    conditions: number;
    observations: number;
    encounters: number;
    medicationRequests: number;
    procedures: number;
    immunizations: number;
  }>;
  /** Up to five conditions, oldest first: name and onset day. */
  conditions: readonly PreviewLine[];
  /** Up to five numeric observations, newest first. */
  observations: readonly Readonly<{
    label: string;
    value: number;
    unit: string;
    date: string | null;
  }>[];
}>;

type Json = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const day = (value: unknown): string | null => {
  const raw = text(value);
  return raw !== null && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};

/** The readable name of a CodeableConcept: its text, else the first coding. */
const conceptName = (concept: unknown): string => {
  const coding = field(concept, "coding");
  const first = Array.isArray(coding) ? coding[0] : undefined;
  return (
    text(field(concept, "text")) ??
    text(field(first, "display")) ??
    text(field(first, "code")) ??
    "Unnamed"
  );
};

const resourcesOf = (bundle: unknown): readonly Json[] => {
  const entries = field(bundle, "entry");
  return Array.isArray(entries)
    ? entries.map((entry) => field(entry, "resource")).filter(isRecord)
    : [];
};

const ofType = (resources: readonly Json[], type: string): readonly Json[] =>
  resources.filter((resource) => resource.resourceType === type);

const byDay =
  (direction: 1 | -1) =>
  (a: Readonly<{ date: string | null }>, b: Readonly<{ date: string | null }>) =>
    direction * (a.date ?? "").localeCompare(b.date ?? "");

/** A summary of one Synthea FHIR bundle, or null when it holds no Patient. */
export const summarisePatientBundle = (bundle: unknown): PatientPreview | null => {
  const resources = resourcesOf(bundle);
  const patient = ofType(resources, "Patient")[0];
  if (patient === undefined) return null;
  const conditions = ofType(resources, "Condition");
  const observations = ofType(resources, "Observation");
  return {
    sex: text(patient.gender) ?? "unknown",
    birthDate: day(patient.birthDate),
    deceasedDate: day(patient.deceasedDateTime),
    counts: {
      conditions: conditions.length,
      observations: observations.length,
      encounters: ofType(resources, "Encounter").length,
      medicationRequests: ofType(resources, "MedicationRequest").length,
      procedures: ofType(resources, "Procedure").length,
      immunizations: ofType(resources, "Immunization").length,
    },
    conditions: conditions
      .map((condition) => ({
        label: conceptName(condition.code),
        date: day(condition.onsetDateTime),
      }))
      .sort(byDay(1))
      .slice(0, 5)
      .map(({ label, date }) => ({ label, detail: date ?? "" })),
    observations: observations
      .flatMap((observation) => {
        const value = field(observation.valueQuantity, "value");
        return typeof value === "number" && Number.isFinite(value)
          ? [
              {
                label: conceptName(observation.code),
                value,
                unit: text(field(observation.valueQuantity, "unit")) ?? "",
                date: day(observation.effectiveDateTime),
              },
            ]
          : [];
      })
      .sort(byDay(-1))
      .slice(0, 5),
  };
};

/** True for a patient bundle file name; Synthea also writes hospital files. */
export const isPatientFile = (name: string): boolean =>
  name.endsWith(".json") && !/^(hospital|practitioner)Information/.test(name);
