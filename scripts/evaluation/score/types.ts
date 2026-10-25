/**
 * What every C3b scorer takes and returns.
 *
 * A scorer is one pure function per criterion. It sees the item, its answer-key
 * entries, one answered results line, and every line of the same item and
 * model (the repeats). `human` means a heuristic could not decide and the
 * answer goes on the review sheet; `na` means the criterion does not apply to
 * the item. Neither is ever counted as a pass.
 */
import type { ResultLine } from "../eval-results";
import type { Criterion, KeyEntry, Question } from "../question-set";

export type Score = "pass" | "fail" | "na" | "human";

export type ScoreResult = Readonly<{ score: Score; reasons: readonly string[] }>;

export type ScoreInput = Readonly<{
  item: Question;
  keyEntries: readonly KeyEntry[];
  /** An answered line: no `error`, no `skipped`, a document. */
  line: AnsweredLine;
  /** Every line of this item and model, answered or not, in repeat order. */
  repeats: readonly ResultLine[];
}>;

export type AnsweredLine = ResultLine &
  Readonly<{
    error: null;
    skipped: null;
    document: NonNullable<ResultLine["document"]>;
  }>;

export type Scorer = (input: ScoreInput) => ScoreResult;

export const isAnswered = (line: ResultLine): line is AnsweredLine =>
  line.error === null && line.skipped === null && line.document !== null;

export const NA: ScoreResult = { score: "na", reasons: [] };

export const applies = (item: Question, criterion: Criterion): boolean =>
  item.criteria.includes(criterion);

/** Fails beat human, human beats pass: one failing check fails the criterion. */
export const verdict = (
  fails: readonly string[],
  humans: readonly string[] = [],
): ScoreResult => {
  if (fails.length > 0) return { score: "fail", reasons: [...fails, ...humans] };
  if (humans.length > 0) return { score: "human", reasons: [...humans] };
  return { score: "pass", reasons: [] };
};
