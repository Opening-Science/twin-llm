import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { utcDay } from "@/infrastructure/day-key";
import { serverEnv } from "@/infrastructure/env";
import { append } from "@/packages/audit/append";
import { toNumber } from "@/packages/query-tools/ports";
import { SYNTHETIC_COHORTS } from "@/packages/query-tools/scope";

import { type ExplorerDeps } from "./explorer-reads";

/**
 * The only database calls behind the Data page. Every query is fixed and takes
 * the cohort id or subject ref as a bound parameter, and every one is limited
 * to `is_synthetic` subjects. The cohort summaries use `$queryRaw` because
 * "distinct subjects per code" and "rows per year" have no Prisma `groupBy`
 * form; the per-subject read is a plain `findMany`. Scope and audit are applied
 * in `explorer-reads.ts`, which the tests drive with fakes instead of these.
 */

/** A Synthea person has a few thousand numeric rows; a subject over this is refused, not cut. */
export const SUBJECT_ROW_CAP = 50_000;

type CodeUnitSql = {
  loinc: string;
  display: string;
  unit: string;
  rows: number;
  subjects: number;
  first: Date;
  last: Date;
};

type SubjectSql = {
  ref: string;
  observations: number;
  codes: number;
  first: Date | null;
  last: Date | null;
};

export const explorerDeps: ExplorerDeps = {
  dataMode: () => serverEnv().DATA_MODE,
  resolveActorId,
  listCohorts: async () => {
    const rows = await database().subject.groupBy({
      by: ["cohortId"],
      where: { isSynthetic: true, cohortId: { in: [...SYNTHETIC_COHORTS] } },
      _count: { _all: true },
    });
    return rows.map((row) => ({ cohortId: row.cohortId, subjects: row._count._all }));
  },
  readAggregates: async (cohortId) => {
    const db = database();
    const inCohort = Prisma.sql`s.cohort_id = ${cohortId} AND s.is_synthetic`;
    const [subjects, codeUnits, codeSubjects, years, nonNumeric] = await Promise.all([
      db.subject.count({ where: { cohortId, isSynthetic: true } }),
      db.$queryRaw<CodeUnitSql[]>(Prisma.sql`
        SELECT o.loinc, MIN(o.display) AS display, o.unit_ucum AS unit,
               COUNT(*)::int AS rows, COUNT(DISTINCT o.subject_ref)::int AS subjects,
               MIN(o.effective_at) AS first, MAX(o.effective_at) AS last
        FROM observations o JOIN subjects s ON s.subject_ref = o.subject_ref
        WHERE ${inCohort}
        GROUP BY o.loinc, o.unit_ucum`),
      db.$queryRaw<{ loinc: string; subjects: number }[]>(Prisma.sql`
        SELECT o.loinc, COUNT(DISTINCT o.subject_ref)::int AS subjects
        FROM observations o JOIN subjects s ON s.subject_ref = o.subject_ref
        WHERE ${inCohort}
        GROUP BY o.loinc`),
      db.$queryRaw<{ year: number; rows: number; subjects: number }[]>(Prisma.sql`
        SELECT EXTRACT(YEAR FROM o.effective_at)::int AS year,
               COUNT(*)::int AS rows, COUNT(DISTINCT o.subject_ref)::int AS subjects
        FROM observations o JOIN subjects s ON s.subject_ref = o.subject_ref
        WHERE ${inCohort}
        GROUP BY 1`),
      db.observationNonNumeric.count({
        where: { subject: { cohortId, isSynthetic: true } },
      }),
    ]);
    return { subjects, nonNumeric, codeUnits, codeSubjects, years };
  },
  listSubjectSummaries: async (cohortId) => {
    const rows = await database().$queryRaw<SubjectSql[]>(Prisma.sql`
      SELECT s.subject_ref AS ref, COUNT(o.id)::int AS observations,
             COUNT(DISTINCT o.loinc)::int AS codes,
             MIN(o.effective_at) AS first, MAX(o.effective_at) AS last
      FROM subjects s LEFT JOIN observations o ON o.subject_ref = s.subject_ref
      WHERE s.cohort_id = ${cohortId} AND s.is_synthetic
      GROUP BY s.subject_ref`);
    return rows.map((row) => ({
      ref: row.ref,
      observations: row.observations,
      codes: row.codes,
      firstDay: row.first ? utcDay(row.first) : null,
      lastDay: row.last ? utcDay(row.last) : null,
    }));
  },
  findSubject: (ref) =>
    database().subject.findUnique({
      where: { subjectRef: ref },
      select: { isSynthetic: true, cohortId: true },
    }),
  subjectRowCap: SUBJECT_ROW_CAP,
  findSubjectObservations: async (ref, take) => {
    const rows = await database().observation.findMany({
      where: { subjectRef: ref, subject: { isSynthetic: true } },
      select: {
        id: true,
        loinc: true,
        display: true,
        value: true,
        unitUcum: true,
        effectiveAt: true,
      },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      take,
    });
    return rows.map((row) => ({
      id: row.id,
      loinc: row.loinc,
      display: row.display,
      value: toNumber(row.value),
      unit: row.unitUcum,
      effectiveAt: row.effectiveAt,
    }));
  },
  countSubjectNonNumeric: (ref) =>
    database().observationNonNumeric.count({
      where: { subjectRef: ref, subject: { isSynthetic: true } },
    }),
  appendAudit: (input) => append(database(), input),
};
