import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { append } from "@/packages/audit/append";
import { toNumber } from "@/packages/query-tools/ports";
import { DISPLAY_SUBJECT_WHERE } from "@/packages/query-tools/synthetic-display";

import { createCohortCache } from "./cohort-cache";
import { readCohortAggregates, readSubjectPage } from "./cohort-queries";
import { type ExplorerDeps } from "./explorer-reads";

/**
 * The only database calls behind the Data page. Every query is fixed and takes
 * the cohort id or subject ref as a bound parameter, and every one is limited
 * to `is_synthetic` subjects (of an allowlisted cohort where the query names no
 * cohort): the synthetic display scope, in any DATA_MODE. The cohort-wide
 * reads (overview, subjects table) are in `cohort-queries.ts`; the per-subject
 * read is a plain `findMany`. Scope and audit are applied in `explorer-reads.ts`, which the tests drive
 * with fakes instead of these.
 *
 * The overview and subject pages scan every row of a cohort, which takes
 * seconds on a 10,000-person cohort, so their results are cached per cohort
 * fingerprint (`cohort-cache.ts`); the audit row is still written each time.
 */

/** A Synthea person has a few thousand numeric rows; a subject over this is refused, not cut. */
export const SUBJECT_ROW_CAP = 50_000;

/** Short, so a stale page can only outlive an unnoticed change briefly. */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 200;

const explorerCache = createCohortCache({
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES,
});

/**
 * Changes whenever a bundle of the cohort is ingested, the cohort is cleared,
 * or a re-ingest fills in subjects' birth years (which writes no bundle).
 */
const cohortFingerprint = async (cohortId: string): Promise<string> => {
  const [bundles, withFacts] = await Promise.all([
    database().bundle.aggregate({
      where: { cohortId },
      _count: { _all: true },
      _max: { ingestedAt: true },
    }),
    database().subject.count({ where: { cohortId, birthYear: { not: null } } }),
  ]);
  return `${bundles._count._all}:${bundles._max.ingestedAt?.toISOString() ?? "none"}:${withFacts}`;
};

const cached = async <T>(
  cohortId: string,
  key: string,
  load: () => Promise<T>,
): Promise<T> =>
  explorerCache.read(`${cohortId}|${key}`, await cohortFingerprint(cohortId), load);

export const explorerDeps: ExplorerDeps = {
  resolveActorId,
  listCohorts: async () => {
    const rows = await database().subject.groupBy({
      by: ["cohortId"],
      where: DISPLAY_SUBJECT_WHERE,
      _count: { _all: true },
    });
    return rows.map((row) => ({ cohortId: row.cohortId, subjects: row._count._all }));
  },
  readAggregates: (cohortId) =>
    cached(cohortId, "aggregates", () => readCohortAggregates(database(), cohortId)),
  readSubjectPage: (cohortId, query) =>
    cached(cohortId, `subjects|${JSON.stringify(query)}`, () =>
      readSubjectPage(database(), cohortId, query),
    ),
  findSubject: (ref) =>
    database().subject.findUnique({
      where: { subjectRef: ref },
      select: { isSynthetic: true, cohortId: true },
    }),
  subjectRowCap: SUBJECT_ROW_CAP,
  findSubjectObservations: async (ref, take) => {
    const rows = await database().observation.findMany({
      where: { subjectRef: ref, subject: DISPLAY_SUBJECT_WHERE },
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
      where: { subjectRef: ref, subject: DISPLAY_SUBJECT_WHERE },
    }),
  appendAudit: (input) => append(database(), input),
};
