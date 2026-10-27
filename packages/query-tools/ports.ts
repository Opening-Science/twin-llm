import "server-only";

import { database } from "@/infrastructure/database";
import { append, type AppendInput } from "@/packages/audit/append";

/**
 * What the query tools need from outside: one subject lookup, two fixed
 * observation queries (one subject's rows, or one code across a cohort), the
 * two fixed clinical-record queries and the audit append. The defaults below are the only
 * Prisma calls the analytics tools make; tests pass in-memory functions, so
 * none of them has to fake a whole Prisma client or replace a module.
 */

export type SubjectScopeRow = Readonly<{
  isSynthetic: boolean;
  cohortId: string;
  /** Stored for synthetic subjects only (#4); `range_position` reads them. */
  sex?: string | null;
  birthYear?: number | null;
}>;

export type ObservationRecord = Readonly<{
  loinc: string;
  value: number;
  unitUcum: string;
  effectiveAt: Date;
  /** The code's display name; a view uses it as its label. */
  display?: string;
  /** The row id; `range_position` breaks a tie at one instant with it. */
  id?: string;
}>;

export type ObservationQuery = Readonly<{
  subjectRef: string;
  loinc: readonly string[];
  start: Date;
  end: Date;
  take: number;
}>;

/** One code in one window across one cohort's synthetic subjects (`cohort_position`). */
export type CohortObservationQuery = Readonly<{
  cohortId: string;
  loinc: string;
  start: Date;
  end: Date;
  take: number;
}>;

export type CohortObservationRecord = ObservationRecord &
  Readonly<{ subjectRef: string }>;

/** A Condition as stored (packages/warehouse/map-clinical.ts). */
export type ConditionRecord = Readonly<{
  id: string;
  codeSystem: string;
  code: string;
  display: string;
  onsetAt: Date | null;
  abatementAt: Date | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
}>;

/** A MedicationRequest as stored; `dosageText` is the record's text, verbatim. */
export type MedicationRequestRecord = Readonly<{
  id: string;
  codeSystem: string;
  code: string;
  display: string;
  authoredAt: Date | null;
  status: string | null;
  intent: string | null;
  dosageText: readonly string[];
}>;

/** One subject's records in a window, optionally one status and one code. */
export type ClinicalQuery = Readonly<{
  subjectRef: string;
  start: Date;
  end: Date;
  status?: string;
  code?: string;
  take: number;
}>;

export type QueryToolPorts = Readonly<{
  findSubject: (subjectRef: string) => Promise<SubjectScopeRow | null>;
  /** Rows ordered by `effectiveAt` ascending, at most `take`. */
  findObservations: (query: ObservationQuery) => Promise<readonly ObservationRecord[]>;
  /**
   * Rows of `is_synthetic` subjects in the cohort, ordered by `effectiveAt`
   * then id, at most `take`.
   */
  findCohortObservations: (
    query: CohortObservationQuery,
  ) => Promise<readonly CohortObservationRecord[]>;
  /**
   * Conditions whose span overlaps the window (onset at or before its end, no
   * abatement or abatement at or after its start), by onset, code, id; at most
   * `take`. Optional so fakes for the observation tools need not stub it; the
   * clinical tools fall back to the default read.
   */
  findConditions?: (query: ClinicalQuery) => Promise<readonly ConditionRecord[]>;
  /** Medication requests authored in the window, by authored date, code, id; at most `take`. Optional as above. */
  findMedicationRequests?: (
    query: ClinicalQuery,
  ) => Promise<readonly MedicationRequestRecord[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value !== null && value !== undefined && typeof value === "object") {
    return Number(value.toString());
  }
  throw new Error("observation value is not numeric");
};

export const findConditionsInDatabase = (
  query: ClinicalQuery,
): Promise<readonly ConditionRecord[]> =>
  database().condition.findMany({
    where: {
      subjectRef: query.subjectRef,
      onsetAt: { lte: query.end },
      OR: [{ abatementAt: null }, { abatementAt: { gte: query.start } }],
      ...(query.status === undefined ? {} : { clinicalStatus: query.status }),
      ...(query.code === undefined ? {} : { code: query.code }),
    },
    select: {
      id: true,
      codeSystem: true,
      code: true,
      display: true,
      onsetAt: true,
      abatementAt: true,
      clinicalStatus: true,
      verificationStatus: true,
    },
    orderBy: [{ onsetAt: "asc" }, { code: "asc" }, { id: "asc" }],
    take: query.take,
  });

export const findMedicationRequestsInDatabase = (
  query: ClinicalQuery,
): Promise<readonly MedicationRequestRecord[]> =>
  database().medicationRequest.findMany({
    where: {
      subjectRef: query.subjectRef,
      authoredAt: { gte: query.start, lte: query.end },
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.code === undefined ? {} : { code: query.code }),
    },
    select: {
      id: true,
      codeSystem: true,
      code: true,
      display: true,
      authoredAt: true,
      status: true,
      intent: true,
      dosageText: true,
    },
    orderBy: [{ authoredAt: "asc" }, { code: "asc" }, { id: "asc" }],
    take: query.take,
  });

export const defaultQueryToolPorts = (): QueryToolPorts => ({
  findSubject: (subjectRef) =>
    database().subject.findUnique({
      where: { subjectRef },
      select: { isSynthetic: true, cohortId: true, sex: true, birthYear: true },
    }),
  findObservations: async (query) => {
    const rows = await database().observation.findMany({
      where: {
        subjectRef: query.subjectRef,
        loinc: { in: [...query.loinc] },
        effectiveAt: { gte: query.start, lte: query.end },
      },
      select: {
        id: true,
        loinc: true,
        display: true,
        value: true,
        unitUcum: true,
        effectiveAt: true,
      },
      orderBy: { effectiveAt: "asc" },
      take: query.take,
    });
    return rows.map((row) => ({ ...row, value: toNumber(row.value) }));
  },
  findCohortObservations: async (query) => {
    const rows = await database().observation.findMany({
      where: {
        loinc: query.loinc,
        effectiveAt: { gte: query.start, lte: query.end },
        subject: { cohortId: query.cohortId, isSynthetic: true },
      },
      select: {
        id: true,
        subjectRef: true,
        loinc: true,
        value: true,
        unitUcum: true,
        effectiveAt: true,
      },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      take: query.take,
    });
    return rows.map((row) => ({ ...row, value: toNumber(row.value) }));
  },
  findConditions: findConditionsInDatabase,
  findMedicationRequests: findMedicationRequestsInDatabase,
  appendAudit: (input) => append(database(), input),
});
