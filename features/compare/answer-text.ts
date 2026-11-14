import {
  hasCanonicalHeading,
  parseTwinAnswer,
  sectionSpans,
} from "@/infrastructure/parse-twin-answer";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import { splitThinking } from "@/infrastructure/think-block";

/**
 * Which part of a reply a column shows (SPEC 2.4, 2.5, 5.1). Pure.
 *
 * While an answer streams only its Answer section is ever on screen: the
 * model's Reasoning and Evidence Used scaffolding, a leaked thinking block and
 * a decline marker never are. Until the Answer section starts the column says
 * what the model is doing instead.
 */

export type StreamingView =
  | Readonly<{ kind: "waiting" }>
  | Readonly<{ kind: "preparing" }>
  | Readonly<{ kind: "answer"; text: string }>;

const LABELS = ["reasoning:", "evidence used:", "answer:", "uncertainty:"] as const;

const DECLINE_MARKER = "REFUSE";

/**
 * A last line still arriving that could turn out to be a section heading: a
 * `#` or emphasis opener, or the start of an inline label ("Unc",
 * "_Uncertainty", "Uncertainty:").
 */
export const mayBecomeHeading = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (/^[#*_]/.test(trimmed)) return true;
  const bare = trimmed.replace(/\s+/g, " ").toLowerCase();
  return LABELS.some((label) => label.startsWith(bare) || bare === label);
};

/** The text with a last, unfinished line held back when it may become a heading. */
const withoutPendingHeading = (text: string): string => {
  const cut = text.lastIndexOf("\n");
  const last = text.slice(cut + 1);
  return mayBecomeHeading(last) ? text.slice(0, cut + 1) : text;
};

/** The reply opens (or may yet open) with the decline marker. */
const opensWithDecline = (text: string): boolean => {
  const trimmed = text.trimStart().replace(/^(?:\*\*|_)/, "");
  if (trimmed.startsWith(DECLINE_MARKER)) {
    return !/^REFUSED/.test(trimmed);
  }
  return trimmed !== "" && DECLINE_MARKER.startsWith(trimmed.trimEnd());
};

/**
 * What a streaming column shows for the text so far. `settled` drops the
 * hold-back of a last line, for text that will not grow any more (a stopped
 * answer).
 */
export const streamingView = (reply: string, settled = false): StreamingView => {
  const { text } = splitThinking(reply);
  if (text.trim() === "") return { kind: "waiting" };
  if (opensWithDecline(text)) return { kind: "preparing" };
  const visible = settled ? text : withoutPendingHeading(text);
  const spans = sectionSpans(visible);
  const answer = spans.answer;
  if (answer === undefined) return { kind: "preparing" };
  // With canonical headings, only the canonical Answer heading starts it: a
  // bold "Summary" inside the reasoning must not stand in for it.
  if (hasCanonicalHeading(visible) && !answer.canonical) return { kind: "preparing" };
  const body = visible.slice(answer.bodyStart, answer.end).trim();
  return body === "" ? { kind: "preparing" } : { kind: "answer", text: body };
};

/** The Answer section written so far of a stopped answer; "" when none was. */
export const stoppedAnswerText = (reply: string): string => {
  const view = streamingView(reply, true);
  return view.kind === "answer" ? view.text : "";
};

export type FinishedAnswer = Readonly<{
  /** The Answer section when the reply is structured, else the whole reply. */
  answer: string;
  uncertainty: string | null;
}>;

/** The text a finished column shows: never a thinking block or the scaffolding. */
export const finishedAnswer = (reply: string): FinishedAnswer => {
  const parsed = parseTwinAnswer(reply, null);
  return { answer: parsed.answerText.trim(), uncertainty: parsed.uncertaintyText };
};

/** The document withholds the answer: it abstained, or declined decision support. */
export const isWithheld = (
  document: Pick<ResponseDocumentV1, "abstained" | "answer_class"> | null | undefined,
): boolean =>
  document !== null &&
  document !== undefined &&
  (document.abstained || document.answer_class === "declined_decision_support");

/** The muted line of a finished answer with nothing to show. */
export const silentAnswerLine = (lookups: number): string =>
  lookups === 0
    ? "This model wrote no answer."
    : lookups === 1
      ? "This model ran 1 lookup and wrote no answer. The step above shows what it returned."
      : `This model ran ${String(lookups)} lookups and wrote no answer. The steps above show what they returned.`;
