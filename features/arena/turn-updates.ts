import type { EffortLevel } from "@/infrastructure/chat-effort";
import type { UiContext } from "@/infrastructure/ui-context";

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
  uiContext: UiContext | null = null,
  effort: EffortLevel | null = null,
): TurnState => ({
  id: PENDING_ID,
  prompt,
  skill,
  ...(uiContext === null ? {} : { uiContext }),
  ...(effort === null ? {} : { effort }),
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
          ...(turn.uiContext ? { uiContext: turn.uiContext } : {}),
          ...(turn.effort ? { effort: turn.effort } : {}),
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

/**
 * Answers that should be streaming and are not yet, with the turn they belong to.
 * A scheduled turn (#54) is being written by the server's own run, so the
 * browser never opens a stream for it.
 */
export const answersToStream = (
  turns: readonly TurnState[],
  inFlight: ReadonlySet<string>,
): Readonly<{
  turnIndex: number;
  turnId: string;
  skill: string | null;
  /** Left out when the turn carried no UI context. */
  uiContext?: UiContext;
  /** Left out when the turn was sent at the default effort or before effort. */
  effort?: EffortLevel;
  response: ResponseState;
}>[] =>
  turns.flatMap((turn, turnIndex) =>
    turn.pending || turn.scheduled === true
      ? []
      : turn.answers
          .filter(
            (response) => response.status === "STREAMING" && !inFlight.has(response.id),
          )
          .map((response) => ({
            turnIndex,
            turnId: turn.id,
            skill: turn.skill ?? null,
            ...(turn.uiContext ? { uiContext: turn.uiContext } : {}),
            ...(turn.effort ? { effort: turn.effort } : {}),
            response,
          })),
  );

/** True while a scheduled turn's answer is still being written on the server (#54). */
export const scheduledStillWriting = (turns: readonly TurnState[]): boolean =>
  turns.some(
    (turn) =>
      turn.scheduled === true &&
      turn.answers.some((answer) => answer.status === "STREAMING"),
  );

/**
 * True while an answer this browser asked for is still streaming, which is
 * when the send tile is a stop tile (#366). A scheduled run streams on the
 * server, not here, so it does not count.
 */
export const answersStreaming = (turns: readonly TurnState[]): boolean =>
  turns.some(
    (turn) =>
      turn.scheduled !== true &&
      turn.answers.some((answer) => answer.status === "STREAMING"),
  );

/**
 * An answer the person stopped (#366): its stream is closed, so it ends here
 * as stopped. In a saved thread the server still finishes and stores it, and
 * a reload shows it.
 */
export const stopResponse = (response: ResponseState): ResponseState =>
  response.status === "STREAMING"
    ? { ...response, status: "FAILED", stopped: true, reviewing: false }
    : response;
