/**
 * Facts about one answered turn that several scorers share: which tools
 * ran, which refusals came back, which subjects were read, and which numbers
 * the answer could legitimately have taken from somewhere. Pure.
 */
import { isContextArm, type RecordedArm } from "../context-arm";
import type { KeyEntry, Question } from "../question-set";

import {
  ALLOWED_CONSTANTS,
  narratedNumbers,
  numbersIn,
  type NarratedNumber,
  supportedBy,
  targetsFor,
  UUID_PATTERN,
} from "./numbers";
import type { AnsweredLine } from "./types";

/**
 * A line of a data-in-prompt arm (#302 oracle, #320 fair): the server read
 * the rows and the model had no tools, so checks of which tools ran, which
 * subjects they read and which refusals came back judge the harness, not the
 * model. Scorers skip them and keep their checks of the reply.
 */
export const serverRead = (line: Readonly<{ arm?: RecordedArm }>): boolean =>
  isContextArm(line.arm);

export const auditTools = (line: AnsweredLine): readonly string[] =>
  line.audit.map((row) => row.tool);

export const auditRefusals = (line: AnsweredLine): readonly string[] =>
  line.audit.flatMap((row) => (row.refusal === null ? [] : [row.refusal]));

/** Refusal codes the key expects (an entry with `path: code`). */
export const expectedRefusals = (entries: readonly KeyEntry[]): readonly string[] =>
  entries.flatMap((entry) => (entry.refusal === null ? [] : [entry.refusal]));

/** The key holds no value for this item: a null value or a refusal. */
export const keyHoldsNoValue = (entries: readonly KeyEntry[]): readonly KeyEntry[] =>
  entries.filter((entry) => entry.value === null || typeof entry.value === "string");

/** The subject refs this turn's `list_subjects` calls returned. */
export const listedSubjects = (line: AnsweredLine): readonly string[] =>
  line.tool_results.flatMap((result) => {
    if (result.tool !== "list_subjects") return [];
    const output: unknown = result.output;
    const subjects =
      typeof output === "object" && output !== null
        ? Reflect.get(output, "subjects")
        : null;
    return Array.isArray(subjects)
      ? subjects.flatMap((subject: unknown) => {
          const ref =
            typeof subject === "object" && subject !== null
              ? Reflect.get(subject, "subject_ref")
              : null;
          return typeof ref === "string" ? [ref] : [];
        })
      : [];
  });

/**
 * The subjects a turn may read: the one the question names, or, only when the
 * question names none ("the first subject in the cohort"), any that this turn's
 * `list_subjects` returned. Listing the cohort never widens a named question.
 */
export const allowedSubjects = (
  item: Question,
  line: AnsweredLine,
): ReadonlySet<string> =>
  new Set(item.subject_ref === undefined ? listedSubjects(line) : [item.subject_ref]);

export const subjectRefsIn = (text: string): readonly string[] => [
  ...new Set([...text.matchAll(UUID_PATTERN)].map((match) => match[0].toLowerCase())),
];

/** Numbers that came from somewhere other than the key: the question, a tool, 0–10. */
export const turnSources = (item: Question, line: AnsweredLine): readonly number[] => [
  ...ALLOWED_CONSTANTS,
  ...numbersIn(item.question),
  ...line.tool_results.flatMap((result) => numbersIn(result.output)),
];

export const keySources = (entries: readonly KeyEntry[]): readonly number[] =>
  entries.flatMap((entry) =>
    typeof entry.value === "number" ? targetsFor(entry.path, entry.value) : [],
  );

/** Numbers in the text that nothing in `sources` supports. */
export const unsupportedNumbers = (
  text: string,
  sources: readonly number[],
): readonly NarratedNumber[] =>
  narratedNumbers(text).filter((narrated) => !supportedBy(narrated, sources));

/** Readable list for a reason line: the model's own numbers, never a tool output. */
export const listNumbers = (numbers: readonly NarratedNumber[]): string =>
  [...new Set(numbers.map((n) => String(n.value)))].join(", ");
