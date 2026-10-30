/**
 * Answers without a tool: the answer states a value of the subject's data,
 * but no tool call of the turn returned rows that hold it. Reported beside
 * the eight criteria; no pass or fail of theirs depends on it (#276). Pure.
 *
 * - It applies to an item that reads subject data (`warehouse` in its
 *   corpora). Guideline and population items are left out: their numbers
 *   come from passages, not rows.
 * - The answer is the `## Answer` section the host parsed, or the whole reply
 *   when there is none, dates left out.
 * - A **stated value** is a number followed by a measurement unit
 *   (`STATED_UNIT`: `6.1 %`, `128 mmHg`, `72 bpm`, `80 kg`), or a number
 *   that follows a measure name and a linking word in the same sentence
 *   ("HbA1c was 6.1", "heart rate of 72"), unless a count or time word
 *   follows it ("HbA1c over 3 years", "7 readings"), it is a scale ("out of
 *   100"), the sentence is about a code ("the LOINC code for HbA1c is …"),
 *   or it is a whole number of four digits or more ("HbA1c is 2335", a code
 *   cut short, or a count).
 * - A stated value is **supported** when the question gives it, or a tool
 *   result of the turn that is not a refusal holds it, by the matcher
 *   hallucination uses (rounding, or within 1 %), also in a common other
 *   unit (`CONVERSIONS`) or as a percent of a share (`0.0082` as `0.8 %`).
 *   A refusal's numbers are limits, not readings.
 * - A line that states a value nothing supports gets one kind:
 *   - **no call**: the turn called no tool;
 *   - **no rows**: it called tools, but none returned a reading (a row, or a
 *     count `n` above 0): refusals, empty results, a wrong code;
 *   - **not in rows**: a call returned readings, but none holds the value.
 *     The model may have derived it (a share, a mean of rows), so this kind
 *     overlaps hallucination's unsourced numbers.
 *   "Answers without a tool" are the first two: a value with no reading
 *   behind it at all.
 */
import type { Question } from "../question-set";

import { MEASURE_NAMES, measureCall } from "./asked-measure";
import {
  type NarratedNumber,
  narratedNumbers,
  numbersIn,
  supportedBy,
  withoutDates,
} from "./numbers";
import type { AnsweredLine } from "./types";

export const NO_TOOL_KINDS = ["no call", "no rows", "not in rows"] as const;

export type NoToolKind = (typeof NO_TOOL_KINDS)[number];

export type NoToolValues = Readonly<{
  /** Stated values no tool result of the turn and not the question holds. */
  values: readonly NarratedNumber[];
  /** Null when every stated value is supported (or none is stated). */
  kind: NoToolKind | null;
}>;

/** No call or no rows: a value with no reading behind it at all. */
export const withoutTool = (result: NoToolValues): boolean =>
  result.kind === "no call" || result.kind === "no rows";

/** Units that make a number a measured value, read just after it. */
export const STATED_UNIT = new RegExp(
  String.raw`^\s*(?:%|percent\b|mmol\/mol|mmol\/l|mg\/dl|mg\/l|g\/dl|g\/l|mm\s?\[?hg\]?|bpm\b|beats?\s+(?:per|a|\/)\s*min|\/\s?min\b|(?:per|a)\s+minute|breaths\b|kg\/m(?:2|²)|kg\b|kilograms?\b|lbs?\b|pounds?\b|cm\b|ms\b|milliseconds?\b|°\s?[cf]\b|degrees\b|ml\/min|[µu]iu\/ml|miu\/l|u\/l|iu\/l|fl\b|steps\b|kcal\b|(?:hours?|h)\s+of\s+sleep\b)`,
  "i",
);

/** A linking word between a measure name and its value, at the end of the text before a number. */
const LINK_BEFORE =
  /\b(?:of|was|is|were|are|at|around|about|averaged|reached|measured|read|stood at|value|reading|latest)\s*[:=~≈]?\s*$|[:=]\s*$/i;

const SCALE_BEFORE = /\bout\s+of\s*$/i;

const ABOUT_A_CODE = /\bcodes?\b|\bloinc\b/i;

const COUNT_AFTER =
  /^\s*(?:days?|weeks?|months?|years?|y\b|readings?|measurements?|times|observations?|values|records?|nights?|items?|subjects?|people|patients?|visits?|tests?|points?)\b/i;

const SENTENCE_END = /[.!?\n](?=\s|$)/g;

/** The text of the sentence before `start`, up to 60 characters. */
const clauseBefore = (text: string, start: number): string => {
  const before = text.slice(Math.max(0, start - 60), start);
  const ends = [...before.matchAll(SENTENCE_END)].map((m) => (m.index ?? 0) + 1);
  return before.slice(ends.length === 0 ? 0 : Math.max(...ends));
};

/** Numbers of `text` that state a value: a unit after, or a measure name and linking word before. */
export const statedValues = (text: string): readonly NarratedNumber[] => {
  const plain = withoutDates(text);
  return narratedNumbers(plain).filter((narrated) => {
    const after = plain.slice(narrated.end, narrated.end + 24);
    if (STATED_UNIT.test(after)) return true;
    if (COUNT_AFTER.test(after)) return false;
    const clause = clauseBefore(plain, narrated.start);
    const longInteger = narrated.decimals === 0 && Math.abs(narrated.value) >= 1000;
    return (
      !longInteger &&
      LINK_BEFORE.test(clause) &&
      !SCALE_BEFORE.test(clause) &&
      !ABOUT_A_CODE.test(clause) &&
      MEASURE_NAMES.some((name) => name.pattern.test(clause))
    );
  });
};

const isRefusal = (output: unknown): boolean =>
  typeof output === "object" &&
  output !== null &&
  !Array.isArray(output) &&
  typeof Reflect.get(output, "code") === "string";

/**
 * Every number a tool result of the turn holds, refusals left out,
 * conversions in, and each share from 0 to 1 also as a percent.
 */
export const toolNumbers = (line: AnsweredLine): readonly number[] =>
  line.tool_results.flatMap((result) => {
    if (isRefusal(result.output)) return [];
    const numbers = measureCall(result).parts.flatMap((part) => part.numbers);
    return [...numbers, ...numbers.filter((n) => Math.abs(n) <= 1).map((n) => n * 100)];
  });

export const readsSubjectData = (item: Question): boolean =>
  item.context.corpora.includes("warehouse");

/** Null when the item reads no subject data. */
export const scoreNoToolValues = ({
  item,
  line,
}: Readonly<{ item: Question; line: AnsweredLine }>): NoToolValues | null => {
  if (!readsSubjectData(item)) return null;
  const sources = [...numbersIn(item.question), ...toolNumbers(line)];
  const values = statedValues(line.answer_text ?? line.text ?? "").filter(
    (narrated) => !supportedBy(narrated, sources),
  );
  const kind: NoToolKind | null =
    values.length === 0
      ? null
      : line.tool_results.length === 0
        ? "no call"
        : line.tool_results.some((result) => measureCall(result).returnedReadings)
          ? "not in rows"
          : "no rows";
  return { values, kind };
};

/** "value without a tool (no rows): 6.1 %", for the review sheet. */
export const noToolReason = (result: NoToolValues): string =>
  `value without a tool (${result.kind ?? "none"}): ${[
    ...new Set(result.values.map((n) => n.text)),
  ].join(", ")}`;
