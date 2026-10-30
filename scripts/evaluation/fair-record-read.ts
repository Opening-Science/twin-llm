/**
 * The server read behind the fair context arm (#320): the subject a question
 * names, checked through the audited query tools, then its whole record. The
 * ports are the database in `run-eval.ts` and fakes in the tests; the block
 * itself is laid out by `fair-context.ts`.
 */
import type { PastedCall } from "./context-arm";
import {
  type FairRead,
  firstSubject,
  type RecordCondition,
  type RecordMedication,
  type RecordObservation,
  type SubjectPick,
} from "./fair-context";

export type FairRecordPorts = Readonly<{
  /** `list_subjects` through the audited tool. */
  listSubjects: (cohortId: string) => Promise<unknown>;
  /** `subject_window` through the audited tool: the scope check. */
  subjectWindow: (subjectRef: string) => Promise<unknown>;
  observations: (subjectRef: string) => Promise<readonly RecordObservation[]>;
  conditions: (subjectRef: string) => Promise<readonly RecordCondition[]>;
  medications: (subjectRef: string) => Promise<readonly RecordMedication[]>;
}>;

/** Set when the cohort lists no subject, so "the first subject" names none. */
export const EMPTY_COHORT = "EMPTY_COHORT";

const refusalCode = (output: unknown): string | null => {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return null;
  const code: unknown = Reflect.get(output, "code");
  return typeof code === "string" ? code : null;
};

const listedRefs = (output: unknown): readonly string[] => {
  const subjects: unknown =
    typeof output === "object" && output !== null
      ? Reflect.get(output, "subjects")
      : null;
  return Array.isArray(subjects)
    ? subjects.flatMap((subject: unknown) => {
        const ref: unknown =
          typeof subject === "object" && subject !== null
            ? Reflect.get(subject, "subject_ref")
            : null;
        return typeof ref === "string" ? [ref] : [];
      })
    : [];
};

/** A record when the subject is in scope; else the tool's refusal. Never reads the key. */
export const readFairRecord = async (
  ports: FairRecordPorts,
  pick: Exclude<SubjectPick, { kind: "none" }>,
): Promise<Readonly<{ read: FairRead; gate: readonly PastedCall[] }>> => {
  const gate: PastedCall[] = [];
  let subjectRef: string;
  if (pick.kind === "first-in-cohort") {
    const input = { cohort_id: pick.cohortId };
    const output = await ports.listSubjects(pick.cohortId);
    gate.push({ tool: "list_subjects", input, output });
    const refused = refusalCode(output);
    const first = firstSubject(listedRefs(output));
    if (refused !== null || first === null) {
      return {
        read: { kind: "refused", subjectRef: null, code: refused ?? EMPTY_COHORT },
        gate,
      };
    }
    subjectRef = first;
  } else {
    subjectRef = pick.subjectRef;
  }
  const window = await ports.subjectWindow(subjectRef);
  gate.push({
    tool: "subject_window",
    input: { subject_ref: subjectRef },
    output: window,
  });
  const refused = refusalCode(window);
  if (refused !== null)
    return { read: { kind: "refused", subjectRef, code: refused }, gate };
  const [observations, conditions, medications] = await Promise.all([
    ports.observations(subjectRef),
    ports.conditions(subjectRef),
    ports.medications(subjectRef),
  ]);
  return {
    read: {
      kind: "record",
      record: { subjectRef, observations, conditions, medications },
    },
    gate,
  };
};
