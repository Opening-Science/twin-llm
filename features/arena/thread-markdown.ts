import {
  frameFooterMarkdown,
  frameHeaderMarkdown,
} from "@/infrastructure/gbd-profile-frame";
import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";
import { readableTitle } from "@/infrastructure/readable-title";

import type { ResponseState, TurnState } from "./conversation";
import type { ToolCard } from "./tool-cards";

/**
 * A thread as Markdown, for an issue, a lab notebook or a paper's appendix:
 * each prompt, then each model's lookups (with their arguments, row counts
 * and refusals) and its answer as the page shows it. Withheld and refused
 * answers say so instead of showing text. A GBD profile's answer keeps the
 * app's header and footer around it (#417), as on the page.
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
  const frame = answer.profileFrame ?? null;
  return [
    ...(frame === null ? [] : frameHeaderMarkdown(frame)),
    body === "" ? "_No written answer._" : body,
    ...(parsed.uncertaintyText ? ["", `**Uncertainty.** ${parsed.uncertaintyText}`] : []),
    ...(frame === null ? [] : frameFooterMarkdown(frame)),
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

/** UTF-8 text as base64, without Node's Buffer. */
const base64 = (text: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/**
 * The same export as a FHIR R4 DocumentReference (#44): the Markdown above is
 * its one attachment, so both formats carry the same content. Tagged research
 * use only; no Patient, no subject reference.
 */
export const threadDocumentReference = (
  thread: ExportableThread,
  markdown: string,
  day: string,
) => ({
  resourceType: "DocumentReference" as const,
  meta: {
    tag: [
      {
        system: "https://opening.science/twinllm",
        code: "research-use-only",
        display: "Research use only; model output, not medical advice",
      },
    ],
  },
  status: "current" as const,
  docStatus: "final" as const,
  type: { text: "TwinLLM thread export" },
  date: `${day}T00:00:00Z`,
  description: readableTitle(thread.title),
  content: [
    {
      attachment: {
        contentType: "text/markdown; charset=utf-8",
        language: "en",
        title: exportFileName(thread.title),
        data: base64(markdown),
      },
    },
  ],
});
