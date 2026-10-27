import { type AppendInput } from "@/packages/audit/append";
import { SUBJECT_SCOPE_VIOLATION, SYNTHETIC_COHORTS } from "@/packages/query-tools/scope";
import {
  displayCohortInScope,
  displaySubjectInScope,
} from "@/packages/query-tools/synthetic-display";

import {
  type CodeSubjectsRow,
  type CodeSummary,
  type CodeUnitRow,
  type CohortTotals,
  cohortTotals,
  summariseCodes,
  type YearRow,
  yearSeries,
} from "./cohort-stats";
import { sexAgeSplit, type SexAgeSplit, type SubjectFactsRow } from "./sex-age-split";
import { type SubjectSummary } from "./subject-table";
import {
  type SubjectObservation,
  type SubjectSeries,
  subjectSeries,
} from "./subject-series";

/**
 * Every warehouse read behind the Data page, under the synthetic display scope
 * (`packages/query-tools/synthetic-display.ts`): only `is_synthetic` subjects
 * of an allowlisted cohort, in any DATA_MODE. The page shows synthetic people
 * only and sends nothing to a model, so a personal-mode machine shows them too.
 * The chat's query tools keep their own, stricter scope (`scope.ts`).
 *
 * The rows are synthetic, but each read still writes an audit row like the
 * chat tools and the Body twin's Demo do (refusals and failed reads too), so the
 * audit chain shows who looked at which subject. A failed read is logged by
 * error name only and the page shows a plain sentence.
 *
 * The functions take their I/O as `ExplorerDeps`; `explorer-ports.ts` holds the
 * real Prisma calls and the tests pass in-memory fakes.
 */

export const OVERVIEW_AUDIT_TOOL = "data-explorer.cohort.overview";
export const SUBJECTS_AUDIT_TOOL = "data-explorer.cohort.subjects";
export const SUBJECT_AUDIT_TOOL = "data-explorer.subject.observations";

export type CohortCount = Readonly<{ cohortId: string; subjects: number }>;

export type CohortAggregates = Readonly<{
  subjects: number;
  nonNumeric: number;
  codeUnits: readonly CodeUnitRow[];
  codeSubjects: readonly CodeSubjectsRow[];
  years: readonly YearRow[];
  /** Subjects per stored sex, birth year and death year (#4). */
  subjectFacts: readonly SubjectFactsRow[];
}>;

export type ExplorerDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  /** Synthetic subjects per allowlisted cohort present in this database. */
  listCohorts: () => Promise<readonly CohortCount[]>;
  readAggregates: (cohortId: string) => Promise<CohortAggregates>;
  listSubjectSummaries: (cohortId: string) => Promise<readonly SubjectSummary[]>;
  findSubject: (
    ref: string,
  ) => Promise<Readonly<{ isSynthetic: boolean; cohortId: string }> | null>;
  /** Oldest first, at most `take` rows. */
  findSubjectObservations: (
    ref: string,
    take: number,
  ) => Promise<readonly SubjectObservation[]>;
  /** Most numeric rows one subject page reads; more is refused, not cut. */
  subjectRowCap: number;
  countSubjectNonNumeric: (ref: string) => Promise<number>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

export type Blocked =
  | Readonly<{ kind: "sign-in" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "too-large" }>;

type Ok<T> = Readonly<{ kind: "ok" } & T>;

type Session = Readonly<{ actor: string }>;

const logFailure = (where: string, error: unknown) =>
  console.error(
    `[data-explorer] ${where} failed`,
    error instanceof Error ? error.name : "unknown",
  );

const openSession = async (deps: ExplorerDeps): Promise<Session | Blocked> => {
  const actor = await deps.resolveActorId();
  return actor ? { actor } : { kind: "sign-in" };
};

const isBlocked = (value: Session | Blocked): value is Blocked => "kind" in value;

const cohortOrder = (id: string): number =>
  (SYNTHETIC_COHORTS as readonly string[]).indexOf(id);

/** Allowlisted cohorts with subjects here, in allowlist order. */
export const loadCohorts = async (
  deps: ExplorerDeps,
): Promise<Ok<{ cohorts: readonly CohortCount[] }> | Blocked> => {
  const session = await openSession(deps);
  if (isBlocked(session)) return session;
  try {
    const cohorts = (await deps.listCohorts())
      .filter((cohort) => displayCohortInScope(cohort.cohortId))
      .filter((cohort) => cohort.subjects > 0)
      .toSorted((a, b) => cohortOrder(a.cohortId) - cohortOrder(b.cohortId));
    return { kind: "ok", cohorts };
  } catch (error) {
    logFailure("cohort list", error);
    return { kind: "failed" };
  }
};

/** The cohort named in the URL if it is listed, else the first one. */
export const pickCohort = (
  cohorts: readonly CohortCount[],
  requested: string | undefined,
): CohortCount | null =>
  cohorts.find((cohort) => cohort.cohortId === requested) ?? cohorts[0] ?? null;

export type CohortOverview = Readonly<{
  totals: CohortTotals;
  codes: readonly CodeSummary[];
  years: readonly YearRow[];
  sexAge: SexAgeSplit;
}>;

/** Living subjects' ages are taken in the year of the cohort's latest reading. */
const referenceYear = (totals: CohortTotals): number | null =>
  totals.lastDay === null ? null : Number(totals.lastDay.slice(0, 4));

const auditFor =
  (
    deps: ExplorerDeps,
    actor: string,
    tool: string,
    subjectRef: string | null,
    args: unknown,
  ) =>
  (result: unknown, rowCount: number) =>
    deps.appendAudit({
      actor,
      sessionId: actor,
      subjectRef,
      tool,
      args,
      result,
      rowCount,
    });

export const loadOverview = async (
  deps: ExplorerDeps,
  cohortId: string,
): Promise<Ok<{ overview: CohortOverview }> | Blocked> => {
  const session = await openSession(deps);
  if (isBlocked(session)) return session;
  const audit = auditFor(deps, session.actor, OVERVIEW_AUDIT_TOOL, null, {
    cohort_id: cohortId,
  });
  if (!displayCohortInScope(cohortId)) {
    // A refusal is audited too, as the query tools' list_subjects does.
    await audit(SUBJECT_SCOPE_VIOLATION, 0);
    return { kind: "not-found" };
  }
  try {
    const raw = await deps.readAggregates(cohortId);
    const totals = cohortTotals(raw.codeUnits, raw.subjects, raw.nonNumeric);
    const overview: CohortOverview = {
      totals,
      codes: summariseCodes(raw.codeUnits, raw.codeSubjects, raw.subjects),
      years: yearSeries(raw.years),
      sexAge: sexAgeSplit(raw.subjectFacts, referenceYear(totals)),
    };
    // Counts per code, year, sex and age band only; the audit row counts the rows they summarise.
    await audit(overview, overview.totals.observations);
    return { kind: "ok", overview };
  } catch (error) {
    logFailure("overview", error);
    await audit({ error: "failed" }, 0).catch(() => undefined);
    return { kind: "failed" };
  }
};

export const loadSubjects = async (
  deps: ExplorerDeps,
  cohortId: string,
): Promise<Ok<{ subjects: readonly SubjectSummary[] }> | Blocked> => {
  const session = await openSession(deps);
  if (isBlocked(session)) return session;
  const audit = auditFor(deps, session.actor, SUBJECTS_AUDIT_TOOL, null, {
    cohort_id: cohortId,
  });
  if (!displayCohortInScope(cohortId)) {
    // A refusal is audited too, as the query tools' list_subjects does.
    await audit(SUBJECT_SCOPE_VIOLATION, 0);
    return { kind: "not-found" };
  }
  try {
    const subjects = await deps.listSubjectSummaries(cohortId);
    await audit(subjects, subjects.length);
    return { kind: "ok", subjects };
  } catch (error) {
    logFailure("subject list", error);
    await audit({ error: "failed" }, 0).catch(() => undefined);
    return { kind: "failed" };
  }
};

export type SubjectRecord = Readonly<{
  ref: string;
  cohortId: string;
  series: readonly SubjectSeries[];
  nonNumeric: number;
}>;

export const loadSubject = async (
  deps: ExplorerDeps,
  ref: string,
): Promise<Ok<{ subject: SubjectRecord }> | Blocked> => {
  const session = await openSession(deps);
  if (isBlocked(session)) return session;
  const audit = auditFor(deps, session.actor, SUBJECT_AUDIT_TOOL, ref, {
    subject_ref: ref,
  });
  try {
    const row = await deps.findSubject(ref);
    if (!displaySubjectInScope(row)) {
      await audit(SUBJECT_SCOPE_VIOLATION, 0);
      return { kind: "not-found" };
    }
    const [observations, nonNumeric] = await Promise.all([
      deps.findSubjectObservations(ref, deps.subjectRowCap + 1),
      deps.countSubjectNonNumeric(ref),
    ]);
    if (observations.length > deps.subjectRowCap) {
      // Cutting the read would drop the newest rows and show a wrong latest value.
      await audit({ code: "ROW_CAP_EXCEEDED", cap: deps.subjectRowCap }, 0);
      return { kind: "too-large" };
    }
    const subject: SubjectRecord = {
      ref,
      cohortId: row.cohortId,
      series: subjectSeries(observations),
      nonNumeric,
    };
    await audit(subject, observations.length);
    return { kind: "ok", subject };
  } catch (error) {
    logFailure("subject read", error);
    await audit({ error: "failed" }, 0).catch(() => undefined);
    return { kind: "failed" };
  }
};
