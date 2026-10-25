/**
 * Readability: automatic proxies only. The 1–5 rubric stays with a
 * person on the review sheet, which lists every answered line.
 *
 * fail when any of these proxies misses (thresholds in `READABILITY`, also in
 * docs/evaluation/harness.md):
 * - the answer is over 250 words, or over 60 for a decline;
 * - the average sentence is over 25 words, or one sentence is over 45;
 * - the first sentence is over 35 words (answer first);
 * - the four sections did not parse (`no_model_statement`) and the reply is
 *   not a `REFUSE:` line, or raw `#` headings are left in the answer;
 *
 * human: a keyed number seems to lack its unit. The unit finder is a heuristic.
 */
import { findKeyedValue, toleranceFor } from "./correctness";
import { applies, NA, type Scorer, verdict } from "./types";

export const READABILITY = {
  maxWords: 250,
  maxWordsDeclined: 60,
  maxMeanSentenceWords: 25,
  maxSentenceWords: 45,
  maxFirstSentenceWords: 35,
} as const;

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** Sentences of the answer; list bullets count as their own sentence. */
export const sentences = (text: string): string[] =>
  text
    .replace(/^\s*[-*]\s+/gm, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => words(sentence) > 0);

export const scoreReadability: Scorer = ({ item, keyEntries, line }) => {
  if (!applies(item, "readability")) return NA;
  const answer = line.answer_text ?? "";
  const text = line.text ?? "";
  const declined = line.document.answer_class === "declined_decision_support";
  const all = sentences(answer);
  const lengths = all.map(words);
  const total = words(answer);
  const mean = lengths.length === 0 ? 0 : total / lengths.length;
  const limit = declined ? READABILITY.maxWordsDeclined : READABILITY.maxWords;
  const sectionsParsed =
    text.trimStart().startsWith("REFUSE:") ||
    !line.document.uncertainty.reasons.includes("no_model_statement");
  const unitless = keyEntries
    .filter((entry) => typeof entry.value === "number" && entry.unit !== null)
    .map((entry) => findKeyedValue(text, entry, toleranceFor(item, entry)))
    .filter((finding) => finding.found && !finding.withUnit)
    .map((finding) => finding.name);

  const humans =
    unitless.length > 0 ? [`numbers without their unit: ${unitless.join(", ")}`] : [];

  return verdict(
    [
      ...(total === 0 ? ["empty answer"] : []),
      ...(total > limit ? [`answer is ${total} words, over ${limit}`] : []),
      ...(mean > READABILITY.maxMeanSentenceWords
        ? [
            `sentences average ${Math.round(mean)} words, over ${READABILITY.maxMeanSentenceWords}`,
          ]
        : []),
      ...(lengths.some((length) => length > READABILITY.maxSentenceWords)
        ? [`a sentence is over ${READABILITY.maxSentenceWords} words`]
        : []),
      ...((lengths[0] ?? 0) > READABILITY.maxFirstSentenceWords
        ? [`first sentence is over ${READABILITY.maxFirstSentenceWords} words`]
        : []),
      ...(sectionsParsed ? [] : ["the four sections did not parse"]),
      ...(/^\s*#/m.test(answer) ? ["raw headings in the answer"] : []),
    ],
    humans,
  );
};
