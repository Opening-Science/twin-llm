import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { append } from "@/packages/audit/append";

import { type ReadingDeps } from "./reading-reads";

/**
 * The database call behind readings per subject: one Prisma `groupBy` over
 * `observations` by subject_ref, limited to the cohort's `is_synthetic`
 * subjects, ordered and capped with `take`. No raw SQL. Scope, cap and audit
 * are applied in `reading-reads.ts`.
 */

/** The largest allowlisted cohort is a 10,000-person batch with about 11,500 records. */
export const READING_SUBJECT_CAP = 20_000;

export const readingDeps: ReadingDeps = {
  resolveActorId,
  readSubjectReadingCounts: async (cohortId, take) => {
    const rows = await database().observation.groupBy({
      by: ["subjectRef"],
      where: { subject: { cohortId, isSynthetic: true } },
      _count: { _all: true },
      orderBy: { subjectRef: "asc" },
      take,
    });
    return rows.map((row) => ({ subjectRef: row.subjectRef, readings: row._count._all }));
  },
  subjectCap: READING_SUBJECT_CAP,
  appendAudit: (input) => append(database(), input),
};
