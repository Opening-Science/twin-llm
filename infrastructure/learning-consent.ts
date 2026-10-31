import { createHash } from "node:crypto";

import { isAllowedCohort } from "@/packages/query-tools/scope";
import type { AppendInput } from "@/packages/audit/append";

import { formatDate } from "./format-measure";

/**
 * Consent to learn from personal data (#145, docs/privacy-design.md 2.4).
 *
 * Every training, answer-key and evaluation pipeline asks one gate,
 * `requireLearningConsent`, before it reads a row. A synthetic row (a
 * warehouse subject that is `is_synthetic` and in `SYNTHETIC_COHORTS`) always
 * passes and needs no consent. A personal row passes only while its owner has
 * an active consent for that scope that covers its source. Anything else is
 * refused with a code and a plain sentence. Off by default: no consent row
 * means no consent, and a consent store that cannot be read counts as none.
 *
 * Making a twin note, searching threads, loading notes into a chat and
 * exporting a thread are the person's own use, not learning, and need no
 * consent here.
 *
 * `permitLearningUse` is pure. `requireLearningConsent` only adds the injected
 * consent read, so a pipeline's tests pass a fake.
 */

export const LEARNING_SCOPES = ["training", "answer-key", "evaluation"] as const;
export type LearningScope = (typeof LEARNING_SCOPES)[number];

export const LEARNING_SOURCES = [
  "wearables",
  "imports",
  "genome",
  "chat",
  "notes",
  "body-scans",
] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

export const isLearningScope = (value: string): value is LearningScope =>
  (LEARNING_SCOPES as readonly string[]).includes(value);

export const isLearningSource = (value: string): value is LearningSource =>
  (LEARNING_SOURCES as readonly string[]).includes(value);

export const SCOPE_LABELS: Readonly<
  Record<LearningScope, Readonly<{ name: string; purpose: string }>>
> = {
  training: {
    name: "Training",
    purpose: "training sets, the conversations a model is fine-tuned on",
  },
  "answer-key": {
    name: "Answer keys",
    purpose: "answer keys, the expected answers a model is checked against",
  },
  evaluation: {
    name: "Evaluation",
    purpose:
      "evaluation runs, where a model answers questions and its answers are scored",
  },
};

export const SOURCE_LABELS: Readonly<Record<LearningSource, string>> = {
  wearables: "wearable summaries",
  imports: "imported records",
  genome: "genome reports",
  chat: "chat threads",
  notes: "twin notes",
  "body-scans": "body scans",
};

/** Bumped whenever the sentence below changes; each grant stores the one it showed. */
export const CONSENT_WORDING_VERSION = "learning-consent.v1";

const listWords = (words: readonly string[]): string =>
  words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/** Sources in the fixed order of `LEARNING_SOURCES`, without repeats. */
export const orderedSources = (
  sources: readonly LearningSource[],
): readonly LearningSource[] =>
  LEARNING_SOURCES.filter((source) => sources.includes(source));

/** The exact sentence a person agrees to; stored with the grant, with its SHA-256. */
export const consentWording = (
  scope: LearningScope,
  sources: readonly LearningSource[],
): string =>
  `I agree that TwinLLM's pipelines on this machine may read my ${listWords(
    orderedSources(sources).map((source) => SOURCE_LABELS[source]),
  )} to make ${SCOPE_LABELS[scope].purpose}. Removing names or dates does not replace this consent. It holds until I withdraw it, and withdrawing stops future use only.`;

export const wordingSha256 = (wording: string): string =>
  createHash("sha256").update(wording, "utf8").digest("hex");

export type LearningConsent = Readonly<{
  id: string;
  userId: string;
  scope: LearningScope;
  sources: readonly LearningSource[];
  wordingVersion: string;
  wordingSha256: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
}>;

/**
 * What a pipeline would read, one entry per kind of row: a warehouse subject
 * (by cohort and its `is_synthetic` flag) or a person's own row by source.
 */
export type LearningRow =
  | Readonly<{ kind: "subject"; cohortId: string; isSynthetic: boolean }>
  | Readonly<{ kind: "personal"; ownerId: string; source: LearningSource }>;

export const LEARNING_REFUSAL_CODES = [
  "SOURCE_NOT_SYNTHETIC",
  "LEARNING_CONSENT_MISSING",
  "LEARNING_CONSENT_WITHDRAWN",
  "LEARNING_CONSENT_SCOPE",
] as const;
export type LearningRefusalCode = (typeof LEARNING_REFUSAL_CODES)[number];

export type LearningDecision =
  | Readonly<{ ok: true; scope: LearningScope; consentIds: readonly string[] }>
  | Readonly<{
      ok: false;
      scope: LearningScope;
      code: LearningRefusalCode;
      message: string;
    }>;

/** Synthetic only when the subject is `is_synthetic` and its cohort is a listed synthetic one. */
export const isSyntheticRow = (row: LearningRow): boolean =>
  row.kind === "subject" && row.isSynthetic && isAllowedCohort(row.cohortId);

/** Active at `at`: granted by then and not withdrawn by then. */
export const isActiveAt = (consent: LearningConsent, at: Date): boolean =>
  consent.grantedAt.getTime() <= at.getTime() &&
  (consent.withdrawnAt === null || consent.withdrawnAt.getTime() > at.getTime());

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

type RowVerdict =
  | Readonly<{ ok: true; consentId: string | null }>
  | Readonly<{ ok: false; code: LearningRefusalCode; message: string }>;

const verdictFor = (
  scope: LearningScope,
  row: LearningRow,
  consents: readonly LearningConsent[],
  at: Date,
): RowVerdict => {
  if (isSyntheticRow(row)) return { ok: true, consentId: null };
  if (row.kind === "subject") {
    return {
      ok: false,
      code: "SOURCE_NOT_SYNTHETIC",
      message: `A subject in cohort "${row.cohortId}" is not marked synthetic or its cohort is not a listed synthetic cohort, and it has no owner who could consent.`,
    };
  }
  const source = SOURCE_LABELS[row.source];
  const scopeName = SCOPE_LABELS[scope].name.toLowerCase();
  const own = consents.filter((consent) => consent.userId === row.ownerId);
  const covering = own.filter(
    (consent) => consent.scope === scope && consent.sources.includes(row.source),
  );
  const active = covering.find((consent) => isActiveAt(consent, at));
  if (active) return { ok: true, consentId: active.id };
  const withdrawn = covering
    .filter((consent) => consent.withdrawnAt !== null && !isActiveAt(consent, at))
    .sort((a, b) => (b.withdrawnAt?.getTime() ?? 0) - (a.withdrawnAt?.getTime() ?? 0))[0];
  if (withdrawn?.withdrawnAt) {
    return {
      ok: false,
      code: "LEARNING_CONSENT_WITHDRAWN",
      message: `Your consent to use your ${source} for ${scopeName} was withdrawn on ${formatDate(isoDay(withdrawn.withdrawnAt))}.`,
    };
  }
  const other = own.filter((consent) => isActiveAt(consent, at));
  if (other.length > 0) {
    return {
      ok: false,
      code: "LEARNING_CONSENT_SCOPE",
      message: `Your consent does not cover your ${source} for ${scopeName}; what you granted covers other uses or other data.`,
    };
  }
  return {
    ok: false,
    code: "LEARNING_CONSENT_MISSING",
    message: `No consent lets ${scopeName} use your ${source}. You can grant it on Customize · Privacy.`,
  };
};

/**
 * The gate's decision over every row a run would read: the first refusal, or
 * a permit naming the consents it relied on (none for synthetic rows).
 */
export const permitLearningUse = ({
  scope,
  rows,
  consents,
  at,
}: Readonly<{
  scope: LearningScope;
  rows: readonly LearningRow[];
  consents: readonly LearningConsent[];
  at: Date;
}>): LearningDecision => {
  const ids = new Set<string>();
  for (const row of rows) {
    const verdict = verdictFor(scope, row, consents, at);
    if (!verdict.ok) {
      return { ok: false, scope, code: verdict.code, message: verdict.message };
    }
    if (verdict.consentId !== null) ids.add(verdict.consentId);
  }
  return { ok: true, scope, consentIds: [...ids].sort() };
};

export type LearningGateDeps = Readonly<{
  /** The consents of these owners; a failure counts as none (fail closed). */
  loadConsents: (ownerIds: readonly string[]) => Promise<readonly LearningConsent[]>;
  now: () => Date;
}>;

/**
 * The one gate every learning pipeline calls before it reads rows, and again
 * before it writes output. Consents are read only when a row is not synthetic,
 * so synthetic runs never touch the consent table.
 */
export const requireLearningConsent = async (
  scope: LearningScope,
  rows: readonly LearningRow[],
  deps: LearningGateDeps,
): Promise<LearningDecision> => {
  const owners = [
    ...new Set(rows.flatMap((row) => (row.kind === "personal" ? [row.ownerId] : []))),
  ].sort();
  const consents =
    owners.length === 0 ? [] : await deps.loadConsents(owners).catch(() => []);
  return permitLearningUse({ scope, rows, consents, at: deps.now() });
};

/**
 * For a run with no app database (it reads files only): every consent read
 * fails, so a personal row is always refused and synthetic rows pass.
 */
export const noConsentStore = (now: () => Date = () => new Date()): LearningGateDeps => ({
  loadConsents: () => Promise.reject(new Error("no consent store in this run")),
  now,
});

/**
 * One line for a command's stderr: the code, the sentence, and what the run
 * did about it (asked before reading, or again before keeping its output).
 */
export const learningRefusalLine = (
  decision: Extract<LearningDecision, { ok: false }>,
  stage: "before-read" | "before-write" = "before-read",
): string =>
  `Refused (${decision.code}): ${decision.message} ${
    stage === "before-read" ? "Nothing was read." : "Nothing was kept."
  }`;

/** What a run's manifest records: the scope and the consent ids it relied on. */
export const learningManifest = (
  decision: Extract<LearningDecision, { ok: true }>,
): Readonly<{ scope: LearningScope; consent_ids: readonly string[] }> => ({
  scope: decision.scope,
  consent_ids: decision.consentIds,
});

/** One row per cohort and flag, from warehouse subject counts. */
export const subjectRowsFrom = (
  groups: readonly Readonly<{ cohortId: string; isSynthetic: boolean }>[],
): readonly LearningRow[] =>
  groups.map((group) => ({
    kind: "subject",
    cohortId: group.cohortId,
    isSynthetic: group.isSynthetic,
  }));

/** The same rows without repeats, first seen first: a cohort of 10,000 subjects is one row. */
export const distinctRows = (rows: readonly LearningRow[]): readonly LearningRow[] => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const LEARNING_AUDIT_TOOLS = {
  grant: "learning.consent.grant",
  withdraw: "learning.consent.withdraw",
} as const;

/** The audit row of a grant or withdrawal: the consent id and how many sources, never wording. */
export const learningAuditEvent = (
  actorId: string,
  event: keyof typeof LEARNING_AUDIT_TOOLS,
  consentId: string,
  sources: number,
): AppendInput => ({
  actor: actorId,
  sessionId: consentId,
  subjectRef: null,
  tool: LEARNING_AUDIT_TOOLS[event],
  args: { event, consentId },
  result: { sources },
  rowCount: sources,
});

export type LearningConsentRow = Readonly<{
  id: string;
  userId: string;
  scope: string;
  sources: readonly string[];
  wordingVersion: string;
  wordingSha256: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
}>;

/** A stored row as the gate reads it, or null when its scope is unknown (it then covers nothing). */
export const consentFromRow = (row: LearningConsentRow): LearningConsent | null =>
  isLearningScope(row.scope)
    ? {
        id: row.id,
        userId: row.userId,
        scope: row.scope,
        sources: row.sources.filter(isLearningSource),
        wordingVersion: row.wordingVersion,
        wordingSha256: row.wordingSha256,
        grantedAt: row.grantedAt,
        withdrawnAt: row.withdrawnAt,
      }
    : null;

export type GrantProblem = "no-sources" | "already-granted";

/** Why a grant cannot be stored, or null: it needs a source, and one active grant per scope. */
export const grantProblem = (
  scope: LearningScope,
  sources: readonly LearningSource[],
  existing: readonly LearningConsent[],
  at: Date,
): GrantProblem | null => {
  if (sources.length === 0) return "no-sources";
  return existing.some((consent) => consent.scope === scope && isActiveAt(consent, at))
    ? "already-granted"
    : null;
};
