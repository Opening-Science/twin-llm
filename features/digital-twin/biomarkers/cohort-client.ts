import { type FormattableMetric } from "@/infrastructure/format-measure";
import {
  type HeldBackNote,
  parseHeldBackNotes,
} from "@/infrastructure/wearable-source-rules";

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

const VITAL_SOURCES = ["oura", "whoop", "googleHealth"] as const;

/**
 * The wearable vitals as the server resolved them (#464): where sources
 * overlapped on a day, only the reading used is left, with its rule, and the
 * measures held back come as notes, once each.
 */
export type VitalSnapshot = Readonly<{
  metrics: readonly FormattableMetric[];
  heldBack: readonly HeldBackNote[];
}>;

export const NO_VITALS: VitalSnapshot = { metrics: [], heldBack: [] };

const heldBackOf = (body: unknown): readonly HeldBackNote[] => {
  const notes = new Map<string, HeldBackNote>();
  for (const source of VITAL_SOURCES) {
    for (const note of parseHeldBackNotes(field(field(body, source), "heldBack"))) {
      notes.set(`${note.measure}|${note.day ?? ""}`, note);
    }
  }
  return [...notes.values()];
};

/** Oura, Whoop and Google Health (BodyLoop has no vitals); none on failure. */
export const loadVitalSnapshot = (fetcher: Fetcher = fetch): Promise<VitalSnapshot> =>
  getJson(fetcher, "/api/wearables/summary")
    .then((body) => ({
      metrics: VITAL_SOURCES.flatMap(
        (source) => listOrNull<FormattableMetric>(field(body, source), "metrics") ?? [],
      ),
      heldBack: heldBackOf(body),
    }))
    .catch(() => NO_VITALS);

/** The metrics alone, for readers that draw series (motion). */
export const loadVitalMetrics = (
  fetcher: Fetcher = fetch,
): Promise<readonly FormattableMetric[]> =>
  loadVitalSnapshot(fetcher).then((snapshot) => snapshot.metrics);
