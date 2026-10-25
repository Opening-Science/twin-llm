/**
 * One classifier for a finished Twin reply, shared by the guardrail runner
 * (canned completions) and the response document builder (live replies), so
 * the test suite and the stored `answer_class` cannot disagree on what a
 * decline looks like. It reads the reply's shape only, never its meaning.
 */
import { sectionLines, TWIN_HEADINGS } from "@/infrastructure/twin-section-lines";

export { TWIN_HEADINGS };

export type CompletionClass = "REFUSE" | "ABSTAIN" | "ANSWER" | "UNSTRUCTURED";

/**
 * The canonical `## X` headings in order (case-insensitive, as the section
 * parser reads them), or the inline labels (`Answer: …`) when the parser
 * would use those, so a reply whose four sections parse either way counts as
 * structured.
 */
export const headingOrder = (text: string): string[] =>
  sectionLines(text).flatMap((line) => {
    if (line.kind === "inline") return [line.heading];
    return line.canonical === null ? [] : [line.canonical];
  });

/**
 * `REFUSE:`, `REFUSE` then a newline, or `REFUSE` alone; not `REFUSED`. Models
 * often wrap the marker in emphasis, so one leading `**` or `_` is allowed
 * (`**REFUSE:**`, `**REFUSE**:`, `_REFUSE_:`), and a closing `*` or `_` may
 * follow the word.
 */
const startsWithMarker = (text: string, marker: "REFUSE" | "ABSTAIN"): boolean =>
  new RegExp(`^(?:\\*\\*|_)?${marker}(?=[:\\s*_]|$)`).test(text.trimStart());

/**
 * The markers come first: the system prompt tells the model to open a declined
 * reply with `REFUSE:` instead of the headings, so a reply that does both
 * still counts as declined.
 */
export const classifyCompletion = (text: string): CompletionClass => {
  if (startsWithMarker(text, "REFUSE")) return "REFUSE";
  if (startsWithMarker(text, "ABSTAIN")) return "ABSTAIN";
  if (headingOrder(text).join("|") === TWIN_HEADINGS.join("|")) return "ANSWER";
  return "UNSTRUCTURED";
};
