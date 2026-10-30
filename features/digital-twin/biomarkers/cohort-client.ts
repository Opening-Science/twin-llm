import { type FormattableMetric } from "@/infrastructure/format-measure";

import { type LabValue } from "./biomarker-rows";
import { type CohortPerson, type CohortRhythm } from "./cohort-handler";

/**
 * The tab's reads, with `fetch` passed in so tests need no network. A cohort
 * read that fails returns null, never an empty list: an empty list would read
 * as "this person has no labs".
 */
export type Fetcher = (url: string) => Promise<Response>;

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;

const listOrNull = <T>(value: unknown, key: string): readonly T[] | null => {
  const items = field(value, key);
  return Array.isArray(items) ? (items as T[]) : null;
};

const getJson = async (fetcher: Fetcher, url: string): Promise<unknown> => {
  const response = await fetcher(url);
  return response.ok ? response.json() : null;
};

export const loadCohortPeople = (
  fetcher: Fetcher = fetch,
): Promise<readonly CohortPerson[] | null> =>
  getJson(fetcher, "/api/biomarkers/cohort")
    .then(
      (body) =>
        listOrNull<CohortPerson>(body, "subjects")?.map((person) => ({
          ref: person.ref,
          label: person.label,
          // Only female or male choose a body and atlas; anything else is unknown.
          sex: person.sex === "female" || person.sex === "male" ? person.sex : null,
        })) ?? null,
    )
    .catch(() => null);

/** A person's newest Anchor values, and their newest vitals for the live twin (G4). */
export type CohortReading = Readonly<{
  values: readonly LabValue[];
  vitals: readonly LabValue[];
  /** The heart rate's day and whether the record lists AF on it (#53). */
  rhythm: CohortRhythm;
}>;

/** Only a well-formed answer counts; anything else is no rhythm, never AF. */
export const rhythmOf = (value: unknown): CohortRhythm => {
  const day = field(value, "day");
  const af = field(value, "afOnDay");
  return typeof day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    typeof af === "boolean"
    ? { day, afOnDay: af }
    : null;
};

export const loadCohortValues = (
  ref: string,
  fetcher: Fetcher = fetch,
): Promise<CohortReading | null> =>
  getJson(fetcher, `/api/biomarkers/cohort/${encodeURIComponent(ref)}`)
    .then((body) => {
      const values = listOrNull<LabValue>(body, "values");
      // No vitals is no motion, never a failed read.
      return values
        ? {
            values,
            vitals: listOrNull<LabValue>(body, "vitals") ?? [],
            rhythm: rhythmOf(field(body, "rhythm")),
          }
        : null;
    })
    .catch(() => null);

/** Oura, Whoop and Google Health metrics (BodyLoop has no vitals); none on failure. */
export const loadVitalMetrics = (
  fetcher: Fetcher = fetch,
): Promise<readonly FormattableMetric[]> =>
  getJson(fetcher, "/api/wearables/summary")
    .then((body) =>
      ["oura", "whoop", "googleHealth"].flatMap(
        (source) => listOrNull<FormattableMetric>(field(body, source), "metrics") ?? [],
      ),
    )
    .catch(() => []);
