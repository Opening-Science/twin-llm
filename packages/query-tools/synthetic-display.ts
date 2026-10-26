import { DEMO_COHORTS, isAllowedCohort, isDemoCohort, SYNTHETIC_COHORTS } from "./scope";

/**
 * The synthetic display scope: screens that only ever show synthetic people to
 * the person at the screen, and send nothing to a model. The Data page and the
 * Body twin's Demo lab values read through it.
 *
 * It does not depend on DATA_MODE. On a personal-mode machine these screens
 * still show the synthetic cohorts, because they can only select `is_synthetic`
 * rows of an allowlisted cohort; there is no argument that widens it.
 *
 * The chat is separate and stays strict: the query tools and show_view use
 * `SessionScope` from `scope.ts`, which reads nothing in personal mode. Nothing
 * here takes or returns a `SessionScope`, so a chat session cannot borrow this
 * path, and this path cannot be widened by a session's mode.
 */

export type DisplaySubject = Readonly<{ isSynthetic: boolean; cohortId: string }>;

/** Prisma `where` for subjects the Data page may read. */
export const DISPLAY_SUBJECT_WHERE: Readonly<{
  isSynthetic: true;
  cohortId: { in: string[] };
}> = {
  isSynthetic: true,
  cohortId: { in: [...SYNTHETIC_COHORTS] },
};

/**
 * Prisma `where` for subjects the Demo may borrow lab values from: never the
 * training or held-out cohorts.
 */
export const DEMO_SUBJECT_WHERE: Readonly<{
  isSynthetic: true;
  cohortId: { in: string[] };
}> = {
  isSynthetic: true,
  cohortId: { in: [...DEMO_COHORTS] },
};

/** A cohort the Data page may show. */
export const displayCohortInScope = (cohortId: string): boolean =>
  isAllowedCohort(cohortId);

/** A subject row the Data page may show: synthetic and in an allowlisted cohort. */
export const displaySubjectInScope = (
  subject: DisplaySubject | null,
): subject is DisplaySubject =>
  subject !== null && subject.isSynthetic && isAllowedCohort(subject.cohortId);

/** A subject row the Demo may show: synthetic and in a Demo cohort. */
export const demoSubjectInScope = (
  subject: DisplaySubject | null,
): subject is DisplaySubject =>
  subject !== null && subject.isSynthetic && isDemoCohort(subject.cohortId);
