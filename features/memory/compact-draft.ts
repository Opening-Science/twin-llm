import { z } from "zod";

import { readableTitle } from "@/infrastructure/readable-title";
import {
  NOTE_LIMITS,
  numberTokens,
  type TwinNoteFields,
  withoutCopiedValues,
} from "@/infrastructure/twin-notes";

/**
 * A `/compact` draft (#43, docs/twin-notes.md). Pure: the handler reads the
 * thread and calls the model; this decides what the model is shown and what
 * of its reply may reach the draft.
 *
 * Measures come from the tool calls' arguments, never their outputs. Topics
 * and open questions come from the model, with every number it wrote that
 * the person did not write themselves (or that is not a measure code)
 * replaced. Nothing here is stored: the person edits and confirms the draft.
 */

type CardArg = Readonly<{ label: string; value: string }>;

/** The parts of a saved thread a draft reads; `OwnedThread` fits it. */
export type CompactThread = Readonly<{
  id: string;
  title: string;
  turns: readonly Readonly<{
    id: string;
    prompt: string;
    answers: readonly Readonly<{
      modelId: string;
      modelName: string;
      status: string;
      text: string;
      tools?: readonly Readonly<{
        tool: string;
        state: string;
        args: readonly CardArg[];
      }>[];
    }>[];
  }>[];
}>;

/** Where the draft's model comes from: the first answer of the latest answered turn. */
export type DraftSource = Readonly<{
  turnId: string;
  modelId: string;
  modelName: string;
  prompt: string;
}>;

export const draftSourceOf = (thread: CompactThread): DraftSource | null => {
  const turn = [...thread.turns]
    .reverse()
    .find((each) => each.answers.some((answer) => answer.status === "COMPLETE"));
  const answer = turn?.answers.find((each) => each.status === "COMPLETE");
  return turn === undefined || answer === undefined
    ? null
    : {
        turnId: turn.id,
        modelId: answer.modelId,
        modelName: answer.modelName,
        prompt: turn.prompt,
      };
};

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const argOf = (args: readonly CardArg[], label: string): string | null =>
  args.find((arg) => arg.label === label)?.value ?? null;

const WINDOW_LABELS = ["Window", "Baseline", "Target", "Window A", "Window B"] as const;

const windowOf = (args: readonly CardArg[]): string => {
  const spans = WINDOW_LABELS.flatMap((label) => {
    const value = argOf(args, label);
    return value === null ? [] : [label === "Window" ? value : `${label} ${value}`];
  });
  return spans.length === 0 ? "no date range" : spans.join("; ");
};

const toolsOf = (thread: CompactThread) =>
  thread.turns.flatMap((turn) =>
    turn.answers.flatMap((answer) =>
      (answer.tools ?? []).filter((tool) => tool.state === "done"),
    ),
  );

/** "Measure · tool · date range" for each finished call that named a measure, once each. */
export const measureLines = (thread: CompactThread): readonly string[] => {
  const lines = toolsOf(thread).flatMap((tool) => {
    const measure = argOf(tool.args, "Measure");
    return measure === null
      ? []
      : [clip(`${measure} · ${tool.tool} · ${windowOf(tool.args)}`, NOTE_LIMITS.line)];
  });
  return [...new Set(lines)].slice(0, NOTE_LIMITS.measures);
};

/** Numbers a model may repeat: the person's own and the measure codes the tools were asked for. */
export const allowedNumbers = (thread: CompactThread): ReadonlySet<string> =>
  new Set([
    ...thread.turns.flatMap((turn) => numberTokens(turn.prompt)),
    ...toolsOf(thread).flatMap((tool) => numberTokens(argOf(tool.args, "Measure") ?? "")),
  ]);

/** The answer's own `## Answer` section when it has one, else its text. */
const answerPart = (text: string): string => {
  const match = /##\s*Answer\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(text);
  return (match?.[1] ?? text).trim();
};

const PER_ANSWER = 600;
const CONVERSATION_BUDGET = 6_000;

export const DRAFT_SYSTEM = [
  "You write a short note of a conversation for the person's own memory.",
  'Reply with JSON only, in this shape: {"topics": ["..."], "open_questions": ["..."]}.',
  "topics: up to 6 short lines, each naming one thing the person asked about.",
  "open_questions: up to 4 short lines on what the conversation left open or could not answer.",
  "Write no numbers, values, results or dates. Give no advice, and never say what the person has.",
].join("\n");

/** The conversation as the model sees it: newest turns kept when it is long. */
export const draftPrompt = (thread: CompactThread): string => {
  const turns = thread.turns.map((turn) => {
    const answer = turn.answers.find((each) => each.status === "COMPLETE");
    return [
      `Person: ${clip(turn.prompt.trim(), PER_ANSWER)}`,
      ...(answer === undefined
        ? []
        : [`Answer: ${clip(answerPart(answer.text), PER_ANSWER)}`]),
    ].join("\n");
  });
  const kept = [...turns]
    .reverse()
    .reduce<{ parts: string[]; used: number }>(
      (acc, part) =>
        acc.used + part.length > CONVERSATION_BUDGET
          ? acc
          : { parts: [part, ...acc.parts], used: acc.used + part.length },
      { parts: [], used: 0 },
    );
  return `Conversation:\n\n${kept.parts.join("\n\n")}`;
};

const replySchema = z.object({
  topics: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
});

export type DraftReply = Readonly<{
  topics: readonly string[];
  openQuestions: readonly string[];
}>;

/** The JSON object in a model reply (thinking and fences ignored), or null. */
export const parseDraftReply = (text: string): DraftReply | null => {
  const body = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = replySchema.safeParse(JSON.parse(body.slice(start, end + 1)));
    return parsed.success
      ? { topics: parsed.data.topics, openQuestions: parsed.data.open_questions }
      : null;
  } catch {
    return null;
  }
};

const cleanLines = (
  items: readonly string[],
  max: number,
  allowed: ReadonlySet<string>,
): readonly string[] =>
  items
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item !== "")
    .slice(0, max)
    .map((item) => clip(withoutCopiedValues(item, allowed), NOTE_LIMITS.line));

/**
 * The draft the person sees. Without a usable reply the topics are the
 * person's own questions and there are no open questions.
 */
export const compactDraft = (
  thread: CompactThread,
  reply: DraftReply | null,
): TwinNoteFields => {
  const allowed = allowedNumbers(thread);
  return {
    title: clip(readableTitle(thread.title), NOTE_LIMITS.title),
    topics:
      reply === null || reply.topics.length === 0
        ? cleanLines(
            thread.turns.map((turn) => turn.prompt),
            NOTE_LIMITS.topics,
            allowed,
          )
        : cleanLines(reply.topics, NOTE_LIMITS.topics, allowed),
    measures: measureLines(thread),
    openQuestions:
      reply === null
        ? []
        : cleanLines(reply.openQuestions, NOTE_LIMITS.openQuestions, allowed),
  };
};
