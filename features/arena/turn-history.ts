import type { TurnState } from "./conversation";

/**
 * What one model is told about the thread so far.
 *
 * Each model keeps its own side of the conversation: every earlier prompt, and
 * after it only that model's own finished answer. Another model's answer never
 * appears, so the columns stay independent and comparable. A turn the model
 * failed, or whose answer was withheld (its text never reaches the browser),
 * contributes the prompt alone.
 */
export type HistoryMessage = Readonly<{ role: "user" | "assistant"; content: string }>;

const ownAnswer = (turn: TurnState, modelId: string): HistoryMessage[] => {
  const answer = turn.answers.find((response) => response.modelId === modelId);
  return answer?.status === "COMPLETE" && answer.text.trim() !== ""
    ? [{ role: "assistant", content: answer.text }]
    : [];
};

/** A skill turn reads back as it was typed, so a follow-up knows what ran. */
const promptOf = (turn: TurnState): string =>
  turn.skill ? `/${turn.skill} ${turn.prompt}` : turn.prompt;

export const historyFor = (
  turns: readonly TurnState[],
  turnIndex: number,
  modelId: string,
): HistoryMessage[] => {
  const earlier = turns
    .slice(0, turnIndex)
    .flatMap((turn): HistoryMessage[] => [
      { role: "user", content: promptOf(turn) },
      ...ownAnswer(turn, modelId),
    ]);
  const current = turns[turnIndex];
  return current ? [...earlier, { role: "user", content: current.prompt }] : earlier;
};
