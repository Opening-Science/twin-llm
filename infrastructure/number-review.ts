import { z } from "zod";

import { answerNumbers, numberSources, type NumberSourcePart } from "./number-sources";
import { sectionSpans, sectionText } from "./parse-twin-answer";
import { splitThinking } from "./think-block";

/**
 * The number check of an Ultra answer (#366): a second specialist reads the
 * finished answer against the turn's tool results and says, for every number
 * the answer wrote, whether a tool result holds it. Each number also carries
 * what the deterministic matcher (`number-sources.ts`, the one behind the
 * answer's number links) found, so a reviewer's mistake shows as a
 * disagreement instead of passing as a fact.
 *
 * The reviewer is a model and can be wrong. The check describes the answer's
 * relation to its tool results; it says nothing about a person.
 *
 * Pure: the prompt, the parsing and the summary. The model call is
 * `features/chat/run-number-review.ts`.
 */

/** The reviewer as named in the step list and the document. */
export const NUMBER_REVIEWER = Object.freeze({
  id: "number-check",
  name: "Number check (research)",
  role: "Reads a finished answer against the tool results it was written from and flags every number no tool result holds. It does not judge health or give advice.",
});

/**
 * The transient stream part that says the check has started, so the answer's
 * step list can show it as the step in progress. Its result comes with the
 * document.
 */
export const NUMBER_REVIEW_PART = "data-number-review";

/** Numbers past this many are left unchecked, so the review prompt stays small. */
export const MAX_REVIEW_NUMBERS = 30;

/** Characters of tool results the reviewer sees; the rest is cut with a note. */
export const MAX_REVIEW_TOOL_CHARS = 12_000;

/** Characters of the answer around a number, so the reviewer knows which one. */
const CONTEXT_CHARS = 40;

export const REVIEW_VERDICTS = ["supported", "unsupported", "unchecked"] as const;

export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const numberReviewItemSchema = z.object({
  /** The number as the answer wrote it. */
  text: z.string().max(64),
  /** The reviewer's verdict; `unchecked` when it gave none. */
  verdict: z.enum(REVIEW_VERDICTS),
  /** The reviewer's short reason for `unsupported`, else null. */
  note: z.string().max(200).nullable(),
  /** True when the deterministic matcher found the number in a tool result. */
  matched: z.boolean(),
});

export const numberReviewSchema = z.object({
  reviewer: z.string().max(80),
  status: z.enum(["done", "failed"]),
  items: z.array(numberReviewItemSchema).max(MAX_REVIEW_NUMBERS),
  /** Numbers past `MAX_REVIEW_NUMBERS` that were not checked. */
  skipped: z.number().int().min(0),
  /** The fixed refusal when the check's request was blocked (#356, #414). */
  refusal: z.string().max(400).optional(),
});

export type NumberReviewItem = z.infer<typeof numberReviewItemSchema>;
export type NumberReview = z.infer<typeof numberReviewSchema>;

export type ReviewNumber = Readonly<{ text: string; context: string; matched: boolean }>;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * The part of a reply the check reads (#379): the Answer section when the reply
 * has one, else the whole reply. The Reasoning, Evidence Used and Uncertainty
 * sections often repeat the answer's numbers, which listed them twice.
 */
export const reviewedAnswer = (reply: string): string =>
  sectionText(sectionSpans(reply), reply, "answer") ?? reply;

/**
 * The answer's numbers to check, in text order, each with a little context.
 * A value written more than once is checked once, at its first place (#379);
 * it counts as matched when the matcher found any of its places.
 */
export const reviewNumbers = (
  answer: string,
  parts: readonly NumberSourcePart[],
): Readonly<{ numbers: readonly ReviewNumber[]; skipped: number }> => {
  const found = answerNumbers(answer);
  const sourced = new Set(numberSources(answer, parts).map((source) => source.start));
  const all = found.filter(
    (narrated, index) =>
      found.findIndex((other) => other.value === narrated.value) === index,
  );
  const numbers = all.slice(0, MAX_REVIEW_NUMBERS).map((narrated) => ({
    text: narrated.text,
    context: oneLine(
      answer.slice(
        Math.max(0, narrated.start - CONTEXT_CHARS),
        narrated.end + CONTEXT_CHARS,
      ),
    ),
    matched: found.some(
      (other) => other.value === narrated.value && sourced.has(other.start),
    ),
  }));
  return { numbers, skipped: Math.max(0, all.length - MAX_REVIEW_NUMBERS) };
};

/** Tool results as the reviewer reads them, cut to `MAX_REVIEW_TOOL_CHARS`. */
export const reviewToolText = (
  results: readonly Readonly<{ toolName: string; output: unknown }>[],
): string => {
  if (results.length === 0) return "(this answer used no tool)";
  const text = results
    .map(
      (result, index) =>
        `[${String(index + 1)}] ${result.toolName}: ${JSON.stringify(result.output) ?? "null"}`,
    )
    .join("\n");
  return text.length <= MAX_REVIEW_TOOL_CHARS
    ? text
    : `${text.slice(0, MAX_REVIEW_TOOL_CHARS)}\n(the rest of the tool results was cut)`;
};

export const REVIEW_SYSTEM = [
  `You are ${NUMBER_REVIEWER.name}, a research reviewer.`,
  NUMBER_REVIEWER.role,
  "For each numbered item, decide whether one of the tool results holds that number, allowing for rounding and for a common unit conversion.",
  "Reply with one line per item and nothing else, in exactly one of these forms:",
  "1. supported",
  "2. unsupported: <a short reason, under 20 words>",
].join("\n");

/** The reviewer's user message: tool results, the answer and the numbers to check. */
export const reviewPrompt = (
  answer: string,
  toolText: string,
  numbers: readonly ReviewNumber[],
): string =>
  [
    "Tool results:",
    toolText,
    "",
    "Answer:",
    answer,
    "",
    "Numbers to check:",
    ...numbers.map(
      (number, index) => `${String(index + 1)}. ${number.text} (in: "${number.context}")`,
    ),
  ].join("\n");

const VERDICT_LINE = /^\s*(\d{1,3})[.):]\s*(supported|unsupported)\b\s*[:\-–—]?\s*(.*)$/i;

/**
 * The reviewer's reply as one verdict per number. A number the reply does not
 * mention stays `unchecked`; a line for a number that was not asked about is
 * ignored; the first line for a number wins.
 */
export const parseReview = (
  reply: string,
  numbers: readonly ReviewNumber[],
): readonly NumberReviewItem[] => {
  const verdicts = splitThinking(reply)
    .text.split("\n")
    .flatMap((line) => {
      const match = VERDICT_LINE.exec(line);
      if (match === null) return [];
      const [, index = "", verdict = "", note = ""] = match;
      return [
        {
          index: Number(index) - 1,
          verdict: verdict.toLowerCase() as "supported" | "unsupported",
          note: oneLine(note).slice(0, 200),
        },
      ];
    });
  return numbers.map((number, index) => {
    const found = verdicts.find((verdict) => verdict.index === index);
    return {
      text: number.text.slice(0, 64),
      verdict: found?.verdict ?? "unchecked",
      note: found?.verdict === "unsupported" && found.note !== "" ? found.note : null,
      matched: number.matched,
    };
  });
};

/**
 * A review that could not run: every number unchecked, with the matcher's
 * view, and the fixed refusal sentence when the request was blocked.
 */
export const failedReview = (
  numbers: readonly ReviewNumber[],
  skipped: number,
  refusal?: string,
): NumberReview => ({
  reviewer: NUMBER_REVIEWER.name,
  status: "failed",
  items: numbers.map((number) => ({
    text: number.text.slice(0, 64),
    verdict: "unchecked",
    note: null,
    matched: number.matched,
  })),
  skipped,
  ...(refusal === undefined ? {} : { refusal }),
});

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** The step's line in the answer's step list. */
export const reviewStepLabel = (review: NumberReview): string => {
  if (review.status === "failed") return "Number check could not run";
  const total = review.items.length;
  if (total === 0) return "Number check: no numbers to check";
  const flagged = review.items.filter((item) => item.verdict === "unsupported").length;
  return flagged === 0
    ? `Number check: ${plural(total, "number", "numbers")} found in the tool results`
    : `Number check: ${String(flagged)} of ${plural(total, "number", "numbers")} flagged`;
};

/**
 * One line per number for the step's detail: the reviewer's verdict, and the
 * matcher's when the two disagree.
 */
export const reviewItemLine = (item: NumberReviewItem): string => {
  const reviewer =
    item.verdict === "supported"
      ? "supported"
      : item.verdict === "unsupported"
        ? `flagged${item.note === null ? "" : `: ${item.note}`}`
        : "not checked";
  const disagrees =
    (item.verdict === "supported" && !item.matched) ||
    (item.verdict === "unsupported" && item.matched);
  const matcher = disagrees
    ? item.matched
      ? " (the number links found it in a tool result)"
      : " (the number links found no tool result for it)"
    : "";
  return `${item.text}: ${reviewer}${matcher}`;
};
