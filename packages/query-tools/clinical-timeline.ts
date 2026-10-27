/**
 * `conditions_timeline` and `medications_timeline` without I/O: the stored
 * records in time order, with counts. Nothing is inferred: a missing date or
 * status stays null, statuses are the record's (as of the end of the
 * simulation, not as of the window), and dosage is the record's own text,
 * verbatim, or null when it has none. No record is linked to another here, so
 * the output says nothing about why a condition or medication is there.
 */
import type { ConditionRecord, MedicationRequestRecord } from "./ports";

/** Records one timeline call may read. More is refused, not cut short. */
export const CLINICAL_ROW_CAP = 1000;

/** The `by_status` key for a record without a status. */
export const UNRECORDED_STATUS = "unrecorded";

export type ConditionEntry = Readonly<{
  code_system: string;
  code: string;
  display: string;
  onset_at: string | null;
  abatement_at: string | null;
  clinical_status: string | null;
  verification_status: string | null;
}>;

export type MedicationEntry = Readonly<{
  code_system: string;
  code: string;
  display: string;
  authored_at: string | null;
  status: string | null;
  intent: string | null;
  /** The record's dosage instruction text, verbatim; null when it has none. */
  dosage_as_recorded: readonly string[] | null;
}>;

export type TimelineCounts = Readonly<{
  /** Records listed. */
  n: number;
  /** Distinct code system and code pairs among them. */
  n_codes: number;
  /** Records per recorded status, `unrecorded` for none; keys sorted. */
  by_status: Readonly<Record<string, number>>;
}>;

export type ConditionsTimeline = TimelineCounts &
  Readonly<{
    /** Conditions with no abatement recorded. */
    n_without_abatement: number;
    conditions: readonly ConditionEntry[];
  }>;

export type MedicationsTimeline = TimelineCounts &
  Readonly<{
    /** Requests whose record has dosage text. */
    n_with_dosage_text: number;
    medications: readonly MedicationEntry[];
  }>;

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

const time = (value: Date | null): number =>
  value === null ? Number.POSITIVE_INFINITY : value.getTime();

type Sortable = Readonly<{ id: string; code: string }>;

/** By date (undated last), then code, then id, so equal dates keep one order. */
const byDateCodeId =
  <T extends Sortable>(dateOf: (row: T) => Date | null) =>
  (a: T, b: T): number =>
    time(dateOf(a)) - time(dateOf(b)) ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const statusCounts = (
  statuses: readonly (string | null)[],
): Readonly<Record<string, number>> => {
  const counts = new Map<string, number>();
  for (const status of statuses) {
    const key = status ?? UNRECORDED_STATUS;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
};

export const distinctCodes = (
  rows: readonly Readonly<{ codeSystem: string; code: string }>[],
): number => new Set(rows.map((row) => `${row.codeSystem}\u0000${row.code}`)).size;

export const conditionsTimeline = (
  rows: readonly ConditionRecord[],
): ConditionsTimeline => {
  const sorted = rows.toSorted(byDateCodeId((row) => row.onsetAt));
  return {
    n: sorted.length,
    n_codes: distinctCodes(sorted),
    by_status: statusCounts(sorted.map((row) => row.clinicalStatus)),
    n_without_abatement: sorted.filter((row) => row.abatementAt === null).length,
    conditions: sorted.map((row) => ({
      code_system: row.codeSystem,
      code: row.code,
      display: row.display,
      onset_at: iso(row.onsetAt),
      abatement_at: iso(row.abatementAt),
      clinical_status: row.clinicalStatus,
      verification_status: row.verificationStatus,
    })),
  };
};

export const medicationsTimeline = (
  rows: readonly MedicationRequestRecord[],
): MedicationsTimeline => {
  const sorted = rows.toSorted(byDateCodeId((row) => row.authoredAt));
  return {
    n: sorted.length,
    n_codes: distinctCodes(sorted),
    by_status: statusCounts(sorted.map((row) => row.status)),
    n_with_dosage_text: sorted.filter((row) => row.dosageText.length > 0).length,
    medications: sorted.map((row) => ({
      code_system: row.codeSystem,
      code: row.code,
      display: row.display,
      authored_at: iso(row.authoredAt),
      status: row.status,
      intent: row.intent,
      dosage_as_recorded: row.dosageText.length > 0 ? [...row.dosageText] : null,
    })),
  };
};
