import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { append } from "@/packages/audit/append";
import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { findConditionsInDatabase, toNumber } from "@/packages/query-tools/ports";
import { AF_SNOMED_CODE } from "@/packages/query-tools/rhythm-recording";
import { windowEndDate, windowStartDate } from "@/packages/query-tools/schemas";
import {
  DEMO_SUBJECT_WHERE,
  demoSubjectInScope,
} from "@/packages/query-tools/synthetic-display";

import { type CohortDeps } from "./cohort-handler";

/**
 * A subject outside the Demo cohorts, or not synthetic, reads as unknown, so its
 * values are never served.
 */
export const demoSubjectOnly = <
  T extends Readonly<{ isSynthetic: boolean; cohortId: string }>,
>(
  row: T | null,
): T | null => (demoSubjectInScope(row) ? row : null);

/**
 * The only Prisma calls behind the cohort routes; tests pass fakes instead.
 * Every one is limited to `DEMO_SUBJECT_WHERE`, in any DATA_MODE.
 */
export const cohortDeps: CohortDeps = {
  resolveActorId,
  listSubjects: async () => {
    const rows = await database().subject.findMany({
      where: DEMO_SUBJECT_WHERE,
      select: { subjectRef: true, sex: true },
      orderBy: { subjectRef: "asc" },
    });
    return rows.map((row) => ({ ref: row.subjectRef, sex: row.sex }));
  },
  findSubject: async (ref) =>
    demoSubjectOnly(
      await database().subject.findUnique({
        where: { subjectRef: ref },
        select: { isSynthetic: true, cohortId: true },
      }),
    ),
  findValues: async (ref, loincs) => {
    const rows = await database().observation.findMany({
      where: {
        subjectRef: ref,
        loinc: { in: [...loincs] },
        subject: DEMO_SUBJECT_WHERE,
      },
      select: { id: true, loinc: true, value: true, unitUcum: true, effectiveAt: true },
    });
    return rows.map((row) => ({ ...row, value: toNumber(row.value) }));
  },
  // The same condition read as `rhythm_irregularity`'s plan; the subject was checked first.
  afOnDay: async (ref, day) =>
    (
      await findConditionsInDatabase({
        subjectRef: ref,
        start: windowStartDate(day),
        end: windowEndDate(day),
        code: AF_SNOMED_CODE,
        take: 1,
      })
    ).length > 0,
  anchorLoincs: () => [...new Set(listBiomarkers().map((marker) => marker.loincCode))],
  appendAudit: (input) => append(database(), input),
};
