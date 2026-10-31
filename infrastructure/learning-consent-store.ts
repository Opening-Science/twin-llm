import "server-only";

import { randomUUID } from "node:crypto";

import { append } from "@/packages/audit/append";

import { database } from "./database";
import {
  consentFromRow,
  consentWording,
  CONSENT_WORDING_VERSION,
  grantProblem,
  type GrantProblem,
  type LearningConsent,
  learningAuditEvent,
  type LearningGateDeps,
  type LearningRow,
  type LearningScope,
  type LearningSource,
  orderedSources,
  subjectRowsFrom,
  wordingSha256,
} from "./learning-consent";

/**
 * The `learning_consents` table (#145) and the reads a pipeline's gate needs.
 * A grant writes its audit row first and stores the consent only when that
 * worked. A withdrawal sets the withdrawn time first, then writes its audit
 * row: a withdrawal must never be blocked by a failed audit write.
 */

const kept = (rows: readonly Parameters<typeof consentFromRow>[0][]) =>
  rows.flatMap((row) => {
    const consent = consentFromRow(row);
    return consent === null ? [] : [consent];
  });

/** Every consent row of these owners, granted or withdrawn. */
export const loadLearningConsents = async (
  ownerIds: readonly string[],
): Promise<readonly LearningConsent[]> =>
  kept(
    await database().learningConsent.findMany({
      where: { userId: { in: [...ownerIds] } },
      orderBy: { grantedAt: "asc" },
    }),
  );

/** The gate's real dependencies: this database's consent table and the clock. */
export const databaseLearningGate = (): LearningGateDeps => ({
  loadConsents: loadLearningConsents,
  now: () => new Date(),
});

/**
 * What the warehouse of this database holds: one row per cohort and
 * `is_synthetic` flag, for the cohorts named (or every cohort when null).
 */
export const warehouseSubjectRows = async (
  cohortIds: readonly string[] | null,
): Promise<readonly LearningRow[]> => {
  const groups = await database().subject.groupBy({
    by: ["cohortId", "isSynthetic"],
    where: cohortIds === null ? {} : { cohortId: { in: [...cohortIds] } },
    orderBy: [{ cohortId: "asc" }, { isSynthetic: "asc" }],
  });
  return subjectRowsFrom(
    groups.map((group) => ({ cohortId: group.cohortId, isSynthetic: group.isSynthetic })),
  );
};

export type GrantOutcome =
  | Readonly<{ ok: true; consent: LearningConsent }>
  | Readonly<{ ok: false; problem: GrantProblem }>;

export const grantLearningConsent = async ({
  actor,
  userId,
  scope,
  sources,
}: Readonly<{
  actor: string;
  userId: string;
  scope: LearningScope;
  sources: readonly LearningSource[];
}>): Promise<GrantOutcome> => {
  const chosen = orderedSources(sources);
  const now = new Date();
  const problem = grantProblem(scope, chosen, await loadLearningConsents([userId]), now);
  if (problem !== null) return { ok: false, problem };
  const id = randomUUID();
  const wording = consentWording(scope, chosen);
  // The audit row first: a grant that cannot be recorded is not stored.
  const audited = await append(
    database(),
    learningAuditEvent(actor, "grant", id, chosen.length),
  );
  const row = await database().learningConsent.create({
    data: {
      id,
      userId,
      scope,
      sources: [...chosen],
      wording,
      wordingVersion: CONSENT_WORDING_VERSION,
      wordingSha256: wordingSha256(wording),
      grantedAt: now,
      auditSeq: audited.seq,
    },
  });
  const consent = consentFromRow(row);
  if (consent === null) throw new Error("stored consent has an unknown scope");
  return { ok: true, consent };
};

/** Sets the withdrawn time of the owner's active consent; false when there is none. */
export const withdrawLearningConsent = async ({
  actor,
  userId,
  consentId,
}: Readonly<{ actor: string; userId: string; consentId: string }>): Promise<boolean> => {
  const changed = await database().learningConsent.updateMany({
    where: { id: consentId, userId, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });
  if (changed.count === 0) return false;
  const row = await database().learningConsent.findUnique({
    where: { id: consentId },
    select: { sources: true },
  });
  try {
    await append(
      database(),
      learningAuditEvent(actor, "withdraw", consentId, row?.sources.length ?? 0),
    );
  } catch (error) {
    console.error(
      "[privacy] withdrawal stored, audit row not written",
      error instanceof Error ? error.name : "unknown",
    );
  }
  return true;
};

/** One person's consents with the sentence each showed, for Customize · Privacy. */
export const listLearningConsentEntries = async (
  userId: string,
): Promise<readonly (LearningConsent & Readonly<{ wording: string }>)[]> =>
  (
    await database().learningConsent.findMany({
      where: { userId },
      orderBy: { grantedAt: "asc" },
    })
  ).flatMap((row) => {
    const consent = consentFromRow(row);
    return consent === null ? [] : [{ ...consent, wording: row.wording }];
  });
