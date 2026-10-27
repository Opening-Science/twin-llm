/**
 * Sex, birth year and death year from a Synthea bundle's Patient (#4). Only
 * `ingestBundle` calls this, after the bundle passed the Synthea marker check,
 * so these facts are only ever kept for synthetic subjects.
 *
 * Only years are read, never a full date. A fact the Patient does not carry is
 * left out (undefined), not set to null, so a bundle without it (a synthetic
 * wearable bundle copies only the Patient's id and identifier) never erases
 * what the subject's own Synthea bundle stored.
 */

export const SUBJECT_SEXES = ["female", "male", "other", "unknown"] as const;

export type SubjectSex = (typeof SUBJECT_SEXES)[number];

export type SubjectFacts = Readonly<{
  sex?: SubjectSex;
  birthYear?: number;
  deathYear?: number;
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSex = (value: unknown): value is SubjectSex =>
  typeof value === "string" && (SUBJECT_SEXES as readonly string[]).includes(value);

/** `1968`, `1968-05` or `1968-05-20…`: the year as written, never shifted by a time zone. */
const YEAR = /^(\d{4})(?:-|$)/;

const yearOf = (value: unknown): number | undefined => {
  const match = typeof value === "string" ? YEAR.exec(value) : null;
  return match ? Number(match[1]) : undefined;
};

const patientOf = (bundle: unknown): Record<string, unknown> | undefined => {
  if (!isObject(bundle) || !Array.isArray(bundle.entry)) return undefined;
  for (const entry of bundle.entry) {
    if (isObject(entry) && isObject(entry.resource)) {
      if (entry.resource.resourceType === "Patient") return entry.resource;
    }
  }
  return undefined;
};

/** The facts the bundle's Patient carries; an empty object when it has none. */
export const subjectFactsFrom = (bundle: unknown): SubjectFacts => {
  const patient = patientOf(bundle);
  if (!patient) return {};
  const sex = isSex(patient.gender) ? patient.gender : undefined;
  const birthYear = yearOf(patient.birthDate);
  const deathYear = yearOf(patient.deceasedDateTime);
  const consistent =
    birthYear === undefined || deathYear === undefined || deathYear >= birthYear;
  return {
    ...(sex === undefined ? {} : { sex }),
    ...(birthYear === undefined ? {} : { birthYear }),
    ...(deathYear === undefined || !consistent ? {} : { deathYear }),
  };
};
