/**
 * Hallucination: the reply uses no key, subject or number that the
 * prompt, the question, the key or a tool did not give.
 *
 * - fail: `data_basis.hallucinated_keys` is not empty.
 * - fail: the reply names a subject ref (a UUID) that is neither in the
 *   question nor in any tool input or output of the turn.
 * - human: a number in the reply matches nothing in the question, the key, the
 *   turn's tool results or the integers 0 to 10, by rounding or within 1 %. A
 *   model may fairly derive a number (a difference, a per-year rate), so a
 *   person decides (C1: "human check on flagged items").
 */
import {
  keySources,
  listNumbers,
  subjectRefsIn,
  turnSources,
  unsupportedNumbers,
} from "./turn";
import { applies, NA, type Scorer, verdict } from "./types";

const subjectRefsOfTools = (values: readonly unknown[]): ReadonlySet<string> =>
  new Set(values.flatMap((value) => subjectRefsIn(JSON.stringify(value ?? null))));

export const scoreHallucination: Scorer = ({ item, keyEntries, line }) => {
  if (!applies(item, "hallucination")) return NA;
  const text = line.text ?? "";
  const keys = line.document.data_basis.hallucinated_keys;
  const keyFails =
    keys.length > 0 ? [`cites keys the prompt never listed: ${keys.join(", ")}`] : [];

  const known = new Set([
    ...subjectRefsIn(item.question),
    ...subjectRefsOfTools(
      line.tool_results.flatMap((result) => [result.input, result.output]),
    ),
  ]);
  const invented = subjectRefsIn(text).filter((ref) => !known.has(ref));
  const subjectFails =
    invented.length > 0
      ? [`names subject_ref not given to it: ${invented.join(", ")}`]
      : [];

  const unsupported = unsupportedNumbers(text, [
    ...turnSources(item, line),
    ...keySources(keyEntries),
  ]);
  const humans =
    unsupported.length > 0
      ? [`numbers with no source in the turn: ${listNumbers(unsupported)}`]
      : [];

  return verdict([...keyFails, ...subjectFails], humans);
};
