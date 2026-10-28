import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";
import { readableTitle } from "@/infrastructure/readable-title";

import type { ResponseState, TurnState } from "./conversation";
import type { ToolCard } from "./tool-cards";

/**
 * A thread as Markdown, for an issue, a lab notebook or a paper's appendix:
 * each prompt, then each model's lookups (with their arguments, row counts
 * and refusals) and its answer as the page shows it. Withheld and refused
 * answers say so instead of showing text.
 *
 * Pure. The route checks the thread is the viewer's before calling it.
 */

export type ExportableThread = Readonly<{
  title: string;
  turns: readonly TurnState[];
}>;

const lookupLine = (card: ToolCard): string => {
  const args = card.args
    .slice(0, 4)
    .map((arg) => `${arg.label.toLowerCase()} ${arg.value}`)
    .join(", ");
  const outcome =
    card.state === "refused"
      ? `refused${card.note ? `: ${card.note}` : ""}`
      : card.rowCount === null
        ? card.state
        : `${card.rowCount} ${card.rowCount === 1 ? "row" : "rows"}`;
  return `- ${card.title}${args ? ` (${args})` : ""} · ${outcome}`;
};

const answerBody = (answer: ResponseState): string[] => {
  if (answer.status === "FAILED") {
    return [`_Refused or failed: ${answer.refusal ?? "no answer"}_`];
  }
  if (answer.status === "STREAMING") return ["_Still being written when exported._"];
  if (
    answer.document?.abstained === true ||
    answer.document?.answer_class === "declined_decision_support"
  ) {
    return ["_Withheld: the answer did not rest on enough data._"];
  }
  const parsed = parseTwinAnswer(answer.text, null);
  const body = parsed.answerText.trim();
  return [
    body === "" ? "_No written answer._" : body,
    ...(parsed.uncertaintyText ? ["", `**Uncertainty.** ${parsed.uncertaintyText}`] : []),
  ];
};

const answerSection = (answer: ResponseState): string[] => {
  const tools = answer.tools ?? [];
  return [
    `### ${answer.modelName}`,
    "",
    ...(tools.length === 0 ? [] : ["Lookups:", ...tools.map(lookupLine), ""]),
    ...answerBody(answer),
    "",
  ];
};

export const threadMarkdown = (thread: ExportableThread, exportedOn: string): string =>
  [
    `# ${readableTitle(thread.title)}`,
    "",
    `Exported from TwinLLM on ${exportedOn}. Research use only; model output, not medical advice.`,
    "",
    ...thread.turns.flatMap((turn, index) => [
      `## ${index + 1}. ${turn.prompt.replace(/\s+/g, " ").trim()}`,
      "",
      ...turn.answers.flatMap(answerSection),
    ]),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");

/** A file name from the title: lower case, dashes, at most 60 characters, whole words. */
export const exportFileName = (title: string): string => {
  const full = readableTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = full.length <= 60 ? full : full.slice(0, 61).replace(/-[^-]*$/, "");
  const slug = cut.replace(/-+$/, "");
  return `${slug === "" ? "thread" : slug}.md`;
};
