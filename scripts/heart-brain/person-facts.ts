/**
 * One synthetic person's dated facts from a Synthea FHIR bundle: birth, sex,
 * death, the first onset of each topic in `codes.ts` and the first oral
 * anticoagulant order. Pure. Reuses the warehouse's condition and medication
 * readers, so this study and the query tools read a bundle the same way.
 * Names, addresses and other made-up demographics are never copied.
 */
import {
  mapConditions,
  mapMedicationRequests,
} from "../../packages/warehouse/map-clinical";

import {
  CEREBROVASCULAR_PATTERN,
  isOralAnticoagulant,
  ORAL_ANTICOAGULANT_PATTERN,
  type Topic,
  topicOf,
} from "./codes";

export type PersonFacts = Readonly<{
  id: string;
  batch: string;
  sex: "F" | "M" | null;
  /** UTC days, YYYY-MM-DD. */
  birth: string;
  death: string | null;
  onsets: Readonly<Partial<Record<Topic, string>>>;
  anticoagulantStart: string | null;
}>;

/** Codes seen that match a search pattern, with how many records carry them. */
export type CodeTally = Readonly<Record<string, number>>;

export type BundleFacts = Readonly<{
  person: PersonFacts;
  /** `code|display` of cerebrovascular conditions, counted per record. */
  cerebrovascular: CodeTally;
  /** `code|display` of oral anticoagulant orders, counted per record. */
  anticoagulants: CodeTally;
}>;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dayOf = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null;

const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

const earlier = (a: string | undefined, b: string): string =>
  a === undefined || b < a ? b : a;

const tally = (keys: readonly string[]): CodeTally =>
  keys.reduce<Record<string, number>>(
    (counts, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 }),
    {},
  );

/** The facts of the bundle's Patient, or null when it has no usable Patient. */
export const bundleFacts = (bundle: unknown, batch: string): BundleFacts | null => {
  if (!isObject(bundle) || !Array.isArray(bundle.entry)) return null;
  const entries: readonly unknown[] = bundle.entry;
  const patient = entries
    .map((entry) => (isObject(entry) ? entry.resource : undefined))
    .find(
      (resource): resource is Json =>
        isObject(resource) && resource.resourceType === "Patient",
    );
  const birth = dayOf(patient?.birthDate);
  if (patient === undefined || typeof patient.id !== "string" || birth === null)
    return null;

  const conditions = mapConditions(entries);
  const onsets = conditions.reduce<Partial<Record<Topic, string>>>((found, row) => {
    const topic = topicOf(row.code);
    if (topic === null || row.onsetAt === null) return found;
    return { ...found, [topic]: earlier(found[topic], utcDay(row.onsetAt)) };
  }, {});

  const medications = mapMedicationRequests(entries);
  const anticoagulantStart = medications
    .filter((row) => isOralAnticoagulant(row.code) && row.authoredAt !== null)
    .map((row) => utcDay(row.authoredAt as Date))
    .reduce<string | null>(
      (first, day) => (first === null || day < first ? day : first),
      null,
    );

  return {
    person: {
      id: patient.id,
      batch,
      sex: patient.gender === "female" ? "F" : patient.gender === "male" ? "M" : null,
      birth,
      death: dayOf(patient.deceasedDateTime),
      onsets,
      anticoagulantStart,
    },
    cerebrovascular: tally(
      conditions
        .filter((row) => CEREBROVASCULAR_PATTERN.test(row.display))
        .map((row) => `${row.code}|${row.display}`),
    ),
    anticoagulants: tally(
      medications
        .filter((row) => ORAL_ANTICOAGULANT_PATTERN.test(row.display))
        .map((row) => `${row.code}|${row.display}`),
    ),
  };
};
