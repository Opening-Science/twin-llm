import { classifyCompletion, TWIN_HEADINGS } from "@/infrastructure/classify-completion";
import {
  hasCanonicalHeading,
  sectionSpans,
  sectionText,
} from "@/infrastructure/parse-twin-answer";
import type { STREAM_STATUS_LINES } from "@/infrastructure/response-document/stream-copy";

/**
 * What a column shows while its answer streams. The raw stream starts with the
 * Reasoning and Evidence Used scaffolding, which is not for reading and would
 * jump away the moment the Answer heading arrives, so until the Answer section
 * starts the column shows one status line instead, and after that only the
 * Answer text. A reply with no recognised headings keeps the status line until
 * it finishes; the finished view then shows it whole, as before.
 */
export type StreamStage = keyof typeof STREAM_STATUS_LINES;

export type StreamingView =
  | Readonly<{ kind: "status"; stage: StreamStage }>
  | Readonly<{ kind: "answer"; text: string }>;

const INLINE_LABELS = TWIN_HEADINGS.map((heading) => `${heading.toLowerCase()}:`);

/** `Unc`, `_Uncertainty` or `Uncertainty:` with nothing after it yet. */
const couldBeInlineLabel = (line: string): boolean => {
  const word = line
    .trim()
    .replace(/^(\*\*|__|\*|_)/, "")
    .replace(/(\*\*|__|\*|_)$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return word !== "" && INLINE_LABELS.some((label) => label.startsWith(word));
};

/**
 * Drops a last line that is still arriving and could become a section heading
 * (`## Unc`, `**Lim`, `Uncert`), so it never flashes as answer text first.
 */
const withoutUnfinishedHeading = (text: string): string => {
  const lastBreak = text.lastIndexOf("\n");
  const last = text.slice(lastBreak + 1);
  return /^\s*[#*]/.test(last) || couldBeInlineLabel(last)
    ? text.slice(0, lastBreak + 1)
    : text;
};

export const streamingView = (text: string): StreamingView => {
  if (text.trim() === "") return { kind: "status", stage: "waiting" };
  // A declined reply has no Answer section; its finished document withholds it.
  if (classifyCompletion(text) === "REFUSE")
    return { kind: "status", stage: "preparing" };
  const settled = withoutUnfinishedHeading(text);
  const spans = sectionSpans(settled);
  // A reply written with the canonical headings gets its answer from
  // `## Answer` once finished, so a `**Summary**` inside the reasoning must not
  // stand in for it while that heading is still on its way.
  if (hasCanonicalHeading(settled) && spans.answer?.canonical !== true) {
    return { kind: "status", stage: "preparing" };
  }
  const answer = sectionText(spans, settled, "answer");
  return answer === null
    ? { kind: "status", stage: "preparing" }
    : { kind: "answer", text: answer };
};
