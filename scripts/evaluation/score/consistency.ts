/**
 * Consistency, with C1's set of fields: across the repeats of one item
 * and model, `answer_class`, `abstained`, `next_step`, `uncertainty.level`,
 * the set of tools called and which keyed values were reported all agree.
 *
 * A keyed value "agrees" when every repeat either reports it within the item's
 * tolerance or none does. Counted once per item and model, not per repeat.
 *
 * - na: the item has one repeat, or fewer than two repeats were answered.
 * - fail: any of the fields above differs between repeats.
 */
import { findKeyedValue, toleranceFor } from "./correctness";
import {
  type AnsweredLine,
  applies,
  isAnswered,
  NA,
  type Scorer,
  verdict,
} from "./types";

type Signature = Readonly<Record<string, string>>;

const signature = (
  line: AnsweredLine,
  valueNames: readonly string[],
  found: (line: AnsweredLine, name: string) => boolean,
): Signature => ({
  answer_class: line.document.answer_class,
  abstained: String(line.document.abstained),
  next_step: line.document.next_step,
  "uncertainty.level": line.document.uncertainty.level,
  tools: [...new Set(line.audit.map((row) => row.tool))].sort().join(","),
  ...Object.fromEntries(
    valueNames.map((name) => [
      `value ${name}`,
      found(line, name) ? "reported" : "missing",
    ]),
  ),
});

export const scoreConsistency: Scorer = ({ item, keyEntries, repeats }) => {
  if (!applies(item, "consistency") || item.repeat < 2) return NA;
  const answered = repeats.filter(isAnswered);
  if (answered.length < 2) {
    return { score: "na", reasons: ["fewer than two answered repeats"] };
  }
  const numeric = keyEntries.filter((entry) => typeof entry.value === "number");
  const found = (line: AnsweredLine, name: string): boolean => {
    const entry = numeric.find((candidate) => candidate.name === name);
    return entry
      ? findKeyedValue(line.text ?? "", entry, toleranceFor(item, entry)).found
      : false;
  };
  const names = numeric.map((entry) => entry.name);
  const signatures = answered.map((line) => signature(line, names, found));
  const first = signatures[0] ?? {};
  const differing = Object.keys(first).filter((field) =>
    signatures.some((other) => other[field] !== first[field]),
  );
  return verdict(differing.map((field) => `${field} differs between repeats`));
};
