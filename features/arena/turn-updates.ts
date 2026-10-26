import type { AnswerSource, ResponseState, TurnState } from "./conversation";

/**
 * Every change the compare screen makes to its turns, as pure functions over
 * the list, so the screen's state updates are one-liners and the rules
 * (pending ids never stream, a retry resets exactly one column) are tested
 * without React.
 */

export const PENDING_ID = "pending";

const streamingAnswer = (
  id: string,
  model: Readonly<{ modelId: string; modelName: string }>,
): ResponseState => ({
  id,
  modelId: model.modelId,
  modelName: model.modelName,
  status: "STREAMING",
  text: "",
  metrics: null,
});

/** The turn shown the moment a prompt is sent, before the server has ids for it. */
export const pendingTurn = (
  prompt: string,
  models: readonly Readonly<{ id: string; name: string }>[],
  skill: string | null = null,
): TurnState => ({
  id: PENDING_ID,
  prompt,
  skill,
  pending: true,
  answers: models.map((model) =>
    streamingAnswer(`${PENDING_ID}:${model.id}`, {
      modelId: model.id,
      modelName: model.name,
    }),
  ),
});

/** Swaps the pending turn for the turn the server created. */
export const confirmTurn = (
  turns: readonly TurnState[],
  turnId: string,
  responses: readonly AnswerSource[],
): TurnState[] =>
  turns.map((turn) =>
    turn.pending
      ? {
          id: turnId,
          prompt: turn.prompt,
          skill: turn.skill ?? null,
          answers: responses.map((response) => streamingAnswer(response.id, response)),
        }
      : turn,
  );

export const dropPending = (turns: readonly TurnState[]): TurnState[] =>
  turns.filter((turn) => !turn.pending);

/** Applies a change to one answer, wherever it is. */
export const updateResponse = (
  turns: readonly TurnState[],
  responseId: string,
  change: (response: ResponseState) => ResponseState,
): TurnState[] =>
  turns.map((turn) =>
    turn.answers.some((response) => response.id === responseId)
      ? {
          ...turn,
          answers: turn.answers.map((response) =>
            response.id === responseId ? change(response) : response,
          ),
        }
      : turn,
  );

/** A failed column starts over; nothing it showed before is kept. */
export const restartResponse = (response: ResponseState): ResponseState =>
  streamingAnswer(response.id, response);

/** Answers that should be streaming and are not yet, with the turn they belong to. */
export const answersToStream = (
  turns: readonly TurnState[],
  inFlight: ReadonlySet<string>,
): Readonly<{
  turnIndex: number;
  turnId: string;
  skill: string | null;
  response: ResponseState;
}>[] =>
  turns.flatMap((turn, turnIndex) =>
    turn.pending
      ? []
      : turn.answers
          .filter(
            (response) => response.status === "STREAMING" && !inFlight.has(response.id),
          )
          .map((response) => ({
            turnIndex,
            turnId: turn.id,
            skill: turn.skill ?? null,
            response,
          })),
  );
