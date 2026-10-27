import { type AppendInput } from "@/packages/audit/append";
import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";
import { displayCohortInScope } from "@/packages/query-tools/synthetic-display";

import { type SubjectReadingCount } from "./reading-counts";

/**
 * The overview's readings-per-subject read: one count of numeric rows per
 * `is_synthetic` subject of an allowlisted cohort, under the synthetic display
 * scope like every other Data page read. It is its own read with its own audit
 * row (`data-explorer.cohort.readings`, no subject_ref), refusals and failed
 * reads included. Counts only: the audit result holds the number of subjects
 * read, the bins are computed from them on the page.
 *
 * The read is capped. A cohort with more subjects than the cap is refused
 * (`ROW_CAP_EXCEEDED`), not cut, because a cut list would draw a wrong
 * distribution. I/O comes in as `ReadingDeps`; `reading-ports.ts` holds the
 * Prisma call and the tests pass fakes.
 */

export const READINGS_AUDIT_TOOL = "data-explorer.cohort.readings";

export type ReadingDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  /** Numeric rows per subject that has any, sorted by subject_ref, at most `take` rows. */
  readSubjectReadingCounts: (
    cohortId: string,
    take: number,
  ) => Promise<readonly SubjectReadingCount[]>;
  /** Most subjects one read returns; more is refused. */
  subjectCap: number;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

export type ReadingsResult =
  | Readonly<{ kind: "ok"; counts: readonly SubjectReadingCount[] }>
  | Readonly<{ kind: "sign-in" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "too-large" }>
  | Readonly<{ kind: "failed" }>;

export const loadReadingCounts = async (
  deps: ReadingDeps,
  cohortId: string,
): Promise<ReadingsResult> => {
  const actor = await deps.resolveActorId();
  if (!actor) return { kind: "sign-in" };
  const audit = (result: unknown, rowCount: number) =>
    deps.appendAudit({
      actor,
      sessionId: actor,
      subjectRef: null,
      tool: READINGS_AUDIT_TOOL,
      args: { cohort_id: cohortId },
      result,
      rowCount,
    });
  if (!displayCohortInScope(cohortId)) {
    await audit(SUBJECT_SCOPE_VIOLATION, 0);
    return { kind: "not-found" };
  }
  try {
    const counts = await deps.readSubjectReadingCounts(cohortId, deps.subjectCap + 1);
    if (counts.length > deps.subjectCap) {
      await audit({ code: "ROW_CAP_EXCEEDED", cap: deps.subjectCap }, 0);
      return { kind: "too-large" };
    }
    const readings = counts.reduce((total, row) => total + row.readings, 0);
    // Counts only; the row count is the observations they summarise, as the overview's is.
    await audit({ subjects: counts.length, readings }, readings);
    return { kind: "ok", counts };
  } catch (error) {
    console.error(
      "[data-explorer] readings per subject failed",
      error instanceof Error ? error.name : "unknown",
    );
    await audit({ error: "failed" }, 0).catch(() => undefined);
    return { kind: "failed" };
  }
};
