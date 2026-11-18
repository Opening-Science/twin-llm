import { splitThinking } from "@/infrastructure/think-block";

import type { HistoryMessage } from "./answer-stream";
import { isWithheld } from "./answer-text";
import type { AnswerState, TurnState } from "./conversation";

/**
 * What one answer column sends as its history (SPEC 8.4): every earlier
 * prompt in order (a skill turn reads back as `/<skill> <prompt>`), each
 * followed by this model's own answer only when that answer finished and
 * has text; then the current prompt. Another model's answer never appears;
 * a failed, stopped or withheld answer leaves its prompt alone.
 */

/** The chat route's limits: 1–100 messages, each 1–32,000 characters. */
const MAX_MESSAGES = 100;
const MAX_CONTENT = 32_000;

const promptOf = (turn: TurnState): string =>
  turn.skill ? `/${turn.skill} ${turn.prompt}` : turn.prompt;

const keptAnswer = (answer: AnswerState | undefined): string | null => {
  if (answer === undefined || answer.status !== "COMPLETE") return null;
  if (answer.stopped === true || isWithheld(answer.document)) return null;
  const text = splitThinking(answer.text).text.trim();
  return text === "" ? null : text;
};

const clip = (content: string): string => content.slice(0, MAX_CONTENT);

export const modelHistory = (
  earlier: readonly TurnState[],
  current: TurnState,
  modelId: string,
): HistoryMessage[] => {
  const past = earlier.flatMap((turn): HistoryMessage[] => {
    const prompt = promptOf(turn).trim();
    if (prompt === "") return [];
    const answer = keptAnswer(turn.answers.find((each) => each.modelId === modelId));
    return answer === null
      ? [{ role: "user", content: clip(prompt) }]
      : [
          { role: "user", content: clip(prompt) },
          { role: "assistant", content: clip(answer) },
        ];
  });
  const messages: HistoryMessage[] = [
    ...past,
    { role: "user", content: clip(current.prompt) },
  ];
  const kept = messages.slice(-MAX_MESSAGES);
  // The window must start on a prompt, never on an answer.
  return kept[0]?.role === "assistant" ? kept.slice(1) : kept;
};

/** The history for an answer of `turnId`, from the turns before it. */
export const historyForTurn = (
  turns: readonly TurnState[],
  turnId: string,
  modelId: string,
): HistoryMessage[] => {
  const index = turns.findIndex((turn) => turn.id === turnId);
  const current = turns[index];
  return current === undefined
    ? []
    : modelHistory(turns.slice(0, index), current, modelId);
};
