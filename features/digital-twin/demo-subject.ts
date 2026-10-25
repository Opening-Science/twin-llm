import { DEMO_SUBJECT_LABEL } from "./anatomy/demo-copy";

/**
 * The synthetic demo subject sits next to the BodyLoop subjects in the Body
 * twin picker. It is client-side only: no database row, no BodyLoop call, so it
 * works with no connection, no subjects and no scans.
 */
export const DEMO_SUBJECT_ID = "demo";

export type SubjectOption = Readonly<{ id: string; label: string }>;

type RealSubject = Readonly<{ id: string; label: string; isSelf: boolean }>;

export const isDemoSubject = (subjectId: string): boolean =>
  subjectId === DEMO_SUBJECT_ID;

/** Real subjects first, as the API lists them (Self marked), then the demo. */
export const subjectOptions = (
  real: readonly RealSubject[],
): readonly SubjectOption[] => [
  ...real.map((row) => ({
    id: row.id,
    label: `${row.label}${row.isSelf ? " (self)" : ""}`,
  })),
  { id: DEMO_SUBJECT_ID, label: DEMO_SUBJECT_LABEL },
];

/** Self when there is one, else the first real subject, else the demo. */
export const defaultSubjectId = (real: readonly RealSubject[]): string =>
  (real.find((row) => row.isSelf) ?? real[0])?.id ?? DEMO_SUBJECT_ID;
