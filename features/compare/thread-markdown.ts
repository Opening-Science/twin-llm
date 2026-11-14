import { formatDate } from "@/infrastructure/format-measure";
import {
  frameFooterMarkdown,
  frameHeaderMarkdown,
} from "@/infrastructure/gbd-profile-frame";
import { readableTitle } from "@/infrastructure/readable-title";
import { citedValueLine } from "@/infrastructure/wearable-provenance";

import { finishedAnswer, isWithheld, stoppedAnswerText } from "./answer-text";
import type { AnswerState, TurnState } from "./conversation";
import { lookupLine, sharedMeasureNames } from "./tool-cards";

/**
 * A saved thread as Markdown (SPEC 9.1, 9.2): the one export text that the
 * FHIR document and the print page are built from, and the text the
 * stored-value check reads. Stored metric keys appear here and nowhere on
 * screen; nothing else that the screen keeps back (text before the Answer
 * section, a withheld answer) is written.
 */

export const EXPORT_DISCLAIMER =
  "For research use and visualisation only: model output, not medical advice.";

const STOPPED_LINE = "_Stopped before it finished._";
const STREAMING_LINE = "_Still being written when this was exported._";
const WITHHELD_LINE = "_Withheld: it did not rest on enough data._";
const NO_ANSWER_LINE = "_No written answer._";

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** "1 Oct 2026" for an ISO day. */
const exportDay = (day: string): string => formatDate(day);

const evidenceLines = (answer: AnswerState): string[] => {
  const chips = answer.attribution ?? [];
  if (chips.length > 0) {
    return [
      "",
      "Evidence:",
      ...chips.map((chip) => {
        const unit = chip.unit === undefined || chip.unit === "" ? "" : ` ${chip.unit}`;
        const line = citedValueLine(chip);
        return `- ${chip.label} ${String(chip.value)}${unit}${line === null ? "" : ` · ${line}`} (\`${chip.metricKey}\`)`;
      }),
    ];
  }
  const keys = answer.document?.data_basis.evidence_keys ?? [];
  return keys.length === 0 ? [] : ["", "Evidence:", ...keys.map((key) => `- \`${key}\``)];
};

const answerBody = (answer: AnswerState): string[] => {
  if (answer.stopped === true) {
    const written = stoppedAnswerText(answer.text);
    return [...(written === "" ? [] : [written, ""]), STOPPED_LINE];
  }
  if (answer.status === "FAILED") {
    return [`_Refused or failed: ${answer.refusal ?? "no answer"}_`];
  }
  if (answer.status === "STREAMING") return [STREAMING_LINE];
  if (isWithheld(answer.document)) return [WITHHELD_LINE];
  const finished = finishedAnswer(answer.text);
  const frame = answer.profileFrame ?? null;
  return [
    ...(frame === null ? [] : frameHeaderMarkdown(frame)),
    finished.answer === "" ? NO_ANSWER_LINE : finished.answer,
    ...(finished.uncertainty === null
      ? []
      : ["", `**Uncertainty.** ${finished.uncertainty}`]),
    ...evidenceLines(answer),
    ...(frame === null ? [] : frameFooterMarkdown(frame)),
  ];
};

const answerBlock = (answer: AnswerState): string[] => {
  const tools = answer.tools ?? [];
  const names = sharedMeasureNames(tools);
  return [
    `### ${answer.modelName}`,
    "",
    ...(tools.length === 0
      ? []
      : ["Lookups:", ...tools.map((card) => lookupLine(card, names)), ""]),
    ...answerBody(answer),
    "",
  ];
};

export type ExportableThread = Readonly<{ title: string; turns: readonly TurnState[] }>;

export const threadMarkdown = (thread: ExportableThread, today: string): string => {
  const lines = [
    `# ${readableTitle(thread.title)}`,
    "",
    `Exported from TwinLLM on ${exportDay(today)}. ${EXPORT_DISCLAIMER}`,
    "",
    ...thread.turns.flatMap((turn, index) => [
      `## ${String(index + 1)}. ${oneLine(turn.prompt)}`,
      "",
      ...turn.answers.flatMap(answerBlock),
    ]),
  ];
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
};

const FILE_NAME_MAX = 60;

/** The readable title as a file name stem: lower case, dashes, whole words, at most 60. */
export const exportSlug = (title: string): string => {
  const slug = readableTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= FILE_NAME_MAX) return slug === "" ? "thread" : slug;
  const cut = slug.slice(0, FILE_NAME_MAX + 1);
  const atWord = cut.lastIndexOf("-");
  const stem = (atWord > 0 ? cut.slice(0, atWord) : slug.slice(0, FILE_NAME_MAX)).replace(
    /-+$/g,
    "",
  );
  return stem === "" ? "thread" : stem;
};

export const markdownFileName = (title: string): string => `${exportSlug(title)}.md`;
