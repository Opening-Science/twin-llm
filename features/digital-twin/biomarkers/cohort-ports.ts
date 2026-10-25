import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { serverEnv } from "@/infrastructure/env";
import { append } from "@/packages/audit/append";
import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { toNumber } from "@/packages/query-tools/ports";
import { DEMO_COHORTS, isDemoCohort } from "@/packages/query-tools/scope";

import { type CohortDeps } from "./cohort-handler";

/** Demo subjects only: never the training or held-out cohorts. */
export const DEMO_SUBJECT_WHERE: Readonly<{
  isSynthetic: true;
  cohortId: { in: string[] };
}> = {
  isSynthetic: true,
  cohortId: { in: [...DEMO_COHORTS] },
};

/** A subject outside the Demo cohorts reads as unknown, so its values are never served. */
export const demoSubjectOnly = <T extends Readonly<{ cohortId: string }>>(
  row: T | null,
): T | null => (row !== null && isDemoCohort(row.cohortId) ? row : null);

/** The only Prisma calls behind the cohort routes; tests pass fakes instead. */
export const cohortDeps: CohortDeps = {
  dataMode: () => serverEnv().DATA_MODE,
  resolveActorId,
  listSubjectRefs: async () => {
    const rows = await database().subject.findMany({
      where: DEMO_SUBJECT_WHERE,
      select: { subjectRef: true },
      orderBy: { subjectRef: "asc" },
    });
    return rows.map((row) => row.subjectRef);
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
      where: { subjectRef: ref, loinc: { in: [...loincs] } },
      select: { id: true, loinc: true, value: true, unitUcum: true, effectiveAt: true },
    });
    return rows.map((row) => ({ ...row, value: toNumber(row.value) }));
  },
  anchorLoincs: () => [...new Set(listBiomarkers().map((marker) => marker.loincCode))],
  appendAudit: (input) => append(database(), input),
};
