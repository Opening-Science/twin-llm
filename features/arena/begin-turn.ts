import type { AnswerRequest, IncognitoAnswerRequest } from "./answer-stream";
import type { AnswerSource } from "./conversation";
import type { StartTurnInput, StartTurnResult } from "./start-turn";
import type { HistoryMessage } from "./turn-history";

/**
 * How the compare screen starts a turn and asks for its answers, for a saved
 * conversation and for an incognito one, as plain functions so the difference
 * is tested without React.
 *
 * A saved turn is written down first (`startTurn`), and each answer streams
 * against its row. An incognito turn is never written anywhere: its ids are
 * made up in the browser, `startTurn` is not called, and each answer goes to
 * `/api/chat/incognito` with no turn id.
 */

export type ConversationMode = "saved" | "incognito";

export type BegunTurn =
  | Readonly<{
      ok: true;
      kind: "saved";
      threadId: string;
      threadTitle: string;
      turnId: string;
      responses: readonly AnswerSource[];
    }>
  | Readonly<{
      ok: true;
      kind: "incognito";
      turnId: string;
      responses: readonly AnswerSource[];
    }>
  | Readonly<{ ok: false; error: string }>;

export type BeginTurnDeps = Readonly<{
  startTurn: (input: StartTurnInput) => Promise<StartTurnResult>;
  randomId: () => string;
}>;

export const beginTurn = async (
  mode: ConversationMode,
  deps: BeginTurnDeps,
  input: StartTurnInput,
): Promise<BegunTurn> => {
  if (mode === "incognito") {
    const turnId = `incognito-${deps.randomId()}`;
    return {
      ok: true,
      kind: "incognito",
      turnId,
      responses: input.models.map(({ id, name }) => ({
        id: `${turnId}:${id}`,
        modelId: id,
        modelName: name,
      })),
    };
  }
  const started = await deps.startTurn(input);
  return started.ok ? { ...started, kind: "saved" } : started;
};

/** The request for one answer: against its row, or incognito with no turn id. */
export const answerRequestFor = (
  mode: ConversationMode,
  answer: Readonly<{
    modelId: string;
    turnId: string;
    messages: readonly HistoryMessage[];
    skill: string | null;
  }>,
): AnswerRequest | IncognitoAnswerRequest => {
  const skill = answer.skill === null ? {} : { skill: answer.skill };
  return mode === "incognito"
    ? { incognito: true, modelId: answer.modelId, messages: answer.messages, ...skill }
    : {
        modelId: answer.modelId,
        turnId: answer.turnId,
        messages: answer.messages,
        ...skill,
      };
};
