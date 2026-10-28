import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { utcDay } from "@/infrastructure/day-key";
import { DISPLAY_SUBJECT_WHERE } from "@/packages/query-tools/synthetic-display";

import { type CohortAggregates } from "./explorer-reads";
import {
  escapeLike,
  pageWindow,
  type SortDir,
  type SubjectPage,
  type SubjectQuery,
  type SubjectSort,
  SUBJECTS_PER_PAGE,
  type SubjectSummary,
} from "./subject-table";

/**
 * The Data page's cohort-wide reads: the overview's aggregates and one page of
 * the subjects table. Both are limited to `is_synthetic` subjects of the
 * cohort; the caller has checked the cohort against the display scope.
 *
 * Overview: "distinct subjects per code" and "rows per year" have no Prisma
 * `groupBy` form, so they are fixed `$queryRaw` statements with the cohort id
 * bound. The per-code-and-unit and per-code counts come from one statement
 * with GROUPING SETS, one pass over the cohort's rows.
 *
 * Subjects table: the search is a case-insensitive subject_ref prefix.
 * Counting, and the page for the ref sort, are plain Prisma calls. The count
 * and day sorts need one key per subject of the cohort to order by, which
 * Prisma cannot express (no ORDER BY on a distinct count, or on MIN/MAX of a
 * relation, and its relation `_count` order counts every cohort), so the
 * page's refs come from one fixed `$queryRaw` with the cohort, search and
 * window bound and the ORDER BY picked from a closed list below: nothing from
 * the URL is spliced into SQL. Either way the page's counts and days then
 * come from two Prisma `groupBy`s over just those 25 subjects. Every query
 * keeps the synthetic display scope's filter.
 *
 * Takes the client as an argument so the DB-backed test can pass its own.
 */

type CodeSql = {
  loinc: string;
  display: string;
  /** Null on the per-code rows of the grouping sets (`unit_ucum` is NOT NULL). */
  unit: string | null;
  rows: number;
  subjects: number;
  first: Date;
  last: Date;
};

export const readCohortAggregates = async (
  db: PrismaClient,
  cohortId: string,
): Promise<CohortAggregates> => {
  const inCohort = Prisma.sql`s.cohort_id = ${cohortId} AND s.is_synthetic`;
  const [subjects, codes, years, nonNumeric, facts] = await Promise.all([
    db.subject.count({ where: { cohortId, isSynthetic: true } }),
    db.$queryRaw<CodeSql[]>(Prisma.sql`
      SELECT o.loinc, MIN(o.display) AS display, o.unit_ucum AS unit,
             COUNT(*)::int AS rows, COUNT(DISTINCT o.subject_ref)::int AS subjects,
             MIN(o.effective_at) AS first, MAX(o.effective_at) AS last
      FROM observations o JOIN subjects s ON s.subject_ref = o.subject_ref
      WHERE ${inCohort}
      GROUP BY GROUPING SETS ((o.loinc, o.unit_ucum), (o.loinc))`),
    db.$queryRaw<{ year: number; rows: number; subjects: number }[]>(Prisma.sql`
      SELECT EXTRACT(YEAR FROM o.effective_at)::int AS year,
             COUNT(*)::int AS rows, COUNT(DISTINCT o.subject_ref)::int AS subjects
      FROM observations o JOIN subjects s ON s.subject_ref = o.subject_ref
      WHERE ${inCohort}
      GROUP BY 1`),
    db.observationNonNumeric.count({
      where: { subject: { cohortId, isSynthetic: true } },
    }),
    db.subject.groupBy({
      by: ["sex", "birthYear", "deathYear"],
      where: { cohortId, isSynthetic: true },
      _count: { _all: true },
    }),
  ]);
  const codeUnits = codes.flatMap(({ unit, ...row }) =>
    unit === null ? [] : [{ ...row, unit }],
  );
  const codeSubjects = codes
    .filter((row) => row.unit === null)
    .map((row) => ({ loinc: row.loinc, subjects: row.subjects }));
  const subjectFacts = facts.map((row) => ({
    sex: row.sex,
    birthYear: row.birthYear,
    deathYear: row.deathYear,
    subjects: row._count._all,
  }));
  return { subjects, nonNumeric, codeUnits, codeSubjects, years, subjectFacts };
};

type AggregateSort = Exclude<SubjectSort, "ref">;

/**
 * The only ORDER BY clauses the raw page query can use. Ties break by ref; the
 * day columns order by UTC day, as the table shows them.
 */
const ORDER_BY: Readonly<Record<AggregateSort, Readonly<Record<SortDir, Prisma.Sql>>>> = {
  observations: {
    asc: Prisma.sql`COUNT(o.id) ASC, s.subject_ref ASC`,
    desc: Prisma.sql`COUNT(o.id) DESC, s.subject_ref ASC`,
  },
  codes: {
    asc: Prisma.sql`COUNT(DISTINCT o.loinc) ASC, s.subject_ref ASC`,
    desc: Prisma.sql`COUNT(DISTINCT o.loinc) DESC, s.subject_ref ASC`,
  },
  first: {
    asc: Prisma.sql`MIN(o.effective_at)::date ASC NULLS LAST, s.subject_ref ASC`,
    desc: Prisma.sql`MIN(o.effective_at)::date DESC NULLS LAST, s.subject_ref ASC`,
  },
  last: {
    asc: Prisma.sql`MAX(o.effective_at)::date ASC NULLS LAST, s.subject_ref ASC`,
    desc: Prisma.sql`MAX(o.effective_at)::date DESC NULLS LAST, s.subject_ref ASC`,
  },
};

const subjectWhere = (cohortId: string, q: string): Prisma.SubjectWhereInput => ({
  AND: [
    DISPLAY_SUBJECT_WHERE,
    { cohortId },
    ...(q
      ? [{ subjectRef: { startsWith: escapeLike(q), mode: "insensitive" as const } }]
      : []),
  ],
});

const day = (value: Date | null | undefined): string | null =>
  value ? utcDay(value) : null;

/** Counts and days for the given subjects, in the given order. */
const summariesFor = async (
  db: PrismaClient,
  refs: readonly string[],
): Promise<readonly SubjectSummary[]> => {
  if (refs.length === 0) return [];
  const where = { subjectRef: { in: [...refs] } };
  const [totals, codes] = await Promise.all([
    db.observation.groupBy({
      by: ["subjectRef"],
      where,
      _count: { _all: true },
      _min: { effectiveAt: true },
      _max: { effectiveAt: true },
    }),
    db.observation.groupBy({ by: ["subjectRef", "loinc"], where }),
  ]);
  const totalOf = new Map(totals.map((row) => [row.subjectRef, row]));
  const codesOf = codes.reduce(
    (counts, row) => counts.set(row.subjectRef, (counts.get(row.subjectRef) ?? 0) + 1),
    new Map<string, number>(),
  );
  return refs.map((ref) => {
    const total = totalOf.get(ref);
    return {
      ref,
      observations: total?._count._all ?? 0,
      codes: codesOf.get(ref) ?? 0,
      firstDay: day(total?._min.effectiveAt),
      lastDay: day(total?._max.effectiveAt),
    };
  });
};

const refPage = async (
  db: PrismaClient,
  where: Prisma.SubjectWhereInput,
  dir: SortDir,
  skip: number,
  take: number,
): Promise<readonly SubjectSummary[]> => {
  const refs = await db.subject.findMany({
    where,
    select: { subjectRef: true },
    orderBy: { subjectRef: dir },
    skip,
    take,
  });
  return summariesFor(
    db,
    refs.map((row) => row.subjectRef),
  );
};

const aggregatePage = async (
  db: PrismaClient,
  cohortId: string,
  query: SubjectQuery & { sort: AggregateSort },
  skip: number,
  take: number,
): Promise<readonly SubjectSummary[]> => {
  const search = query.q
    ? Prisma.sql`AND s.subject_ref ILIKE ${`${escapeLike(query.q)}%`}`
    : Prisma.empty;
  // Only the sort key is computed for the whole cohort; the page's counts
  // and days then come from the same Prisma reads as the ref sort.
  const rows = await db.$queryRaw<{ ref: string }[]>(Prisma.sql`
    SELECT s.subject_ref AS ref
    FROM subjects s LEFT JOIN observations o ON o.subject_ref = s.subject_ref
    WHERE s.cohort_id = ${cohortId} AND s.is_synthetic
      AND s.cohort_id IN (${Prisma.join(DISPLAY_SUBJECT_WHERE.cohortId.in)})
      ${search}
    GROUP BY s.subject_ref
    ORDER BY ${ORDER_BY[query.sort][query.dir]}
    LIMIT ${take} OFFSET ${skip}`);
  return summariesFor(
    db,
    rows.map((row) => row.ref),
  );
};

const isAggregateSort = (
  query: SubjectQuery,
): query is SubjectQuery & { sort: AggregateSort } => query.sort !== "ref";

/** The cohort is checked against the display scope by the caller as well. */
export const readSubjectPage = async (
  db: PrismaClient,
  cohortId: string,
  query: SubjectQuery,
  perPage: number = SUBJECTS_PER_PAGE,
): Promise<SubjectPage> => {
  const where = subjectWhere(cohortId, query.q);
  const [total, matching] = await Promise.all([
    db.subject.count({ where: subjectWhere(cohortId, "") }),
    query.q ? db.subject.count({ where }) : null,
  ]);
  const found = matching ?? total;
  const window = pageWindow(query.page, found, perPage);
  const rows =
    found === 0
      ? []
      : isAggregateSort(query)
        ? await aggregatePage(db, cohortId, query, window.skip, window.take)
        : await refPage(db, where, query.dir, window.skip, window.take);
  return { rows, matching: found, total, page: window.page, pages: window.pages };
};
