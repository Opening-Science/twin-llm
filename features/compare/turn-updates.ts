import { numberSources } from "@/infrastructure/number-sources";
import {
  parseTwinAnswer,
  type WearableSummaries,
} from "@/infrastructure/parse-twin-answer";
import type { UiContext } from "@/infrastructure/ui-context";

import type { StreamProgress, StreamResult } from "./answer-stream";
import type { AnswerState, PromptSend, TurnState } from "./conversation";

/**
 * The conversation's state changes, as pure functions (SPEC 2.3, 2.7, 8,
 * 10.11). Each returns new state; nothing here reads the network.
 */

/** True while a scheduled turn's answer is still being written on the server (SPEC 2.8). */
export const scheduledStillWriting = (turns: readonly TurnState[]): boolean =>
  turns.some(
    (turn) =>
      turn.scheduled === true && turn.answers.some((a) => a.status === "STREAMING"),
  );

const streamingAnswer = (
  id: string,
  modelId: string,
  modelName: string,
): AnswerState => ({
  id,
  modelId,
  modelName,
  status: "STREAMING",
  text: "",
  metrics: null,
});

type TurnExtras = Readonly<{ uiContext?: UiContext }>;

const turnOf = (
  id: string,
  send: PromptSend,
  answers: readonly AnswerState[],
  extras: TurnExtras,
): TurnState => ({
  id,
  prompt: send.prompt,
  ...(send.label === null ? {} : { label: send.label }),
  answers,
  ...(send.skill === null ? {} : { skill: send.skill }),
  effort: send.effort,
  ...(extras.uiContext === undefined ? {} : { uiContext: extras.uiContext }),
});

/** Shown at once while the server writes the turn; nothing streams against it. */
export const provisionalTurn = (
  id: string,
  send: PromptSend,
  extras: TurnExtras = {},
): TurnState => ({
  ...turnOf(
    id,
    send,
    send.models.map((model) =>
      streamingAnswer(`${id}:${model.id}`, model.id, model.name),
    ),
    extras,
  ),
  provisional: true,
});

/** The server's ids in place of the provisional ones; same prompt, label, skill, effort, context. */
export const confirmedTurn = (
  provisional: TurnState,
  written: Readonly<{
    turnId: string;
    responses: readonly Readonly<{ id: string; modelId: string; modelName: string }>[];
  }>,
): TurnState => {
  const { provisional: _wasProvisional, ...rest } = provisional;
  return {
    ...rest,
    id: written.turnId,
    answers: written.responses.map((row) =>
      streamingAnswer(row.id, row.modelId, row.modelName),
    ),
  };
};

/** An incognito turn: browser ids only (`<turn id>:<model id>`), streaming at once. */
export const incognitoTurn = (turnId: string, send: PromptSend): TurnState =>
  turnOf(
    turnId,
    send,
    send.models.map((model) =>
      streamingAnswer(`${turnId}:${model.id}`, model.id, model.name),
    ),
    {},
  );

export const withTurnReplaced = (
  turns: readonly TurnState[],
  turnId: string,
  next: TurnState | null,
): TurnState[] =>
  turns.flatMap((turn) => (turn.id !== turnId ? [turn] : next === null ? [] : [next]));

/** One answer changed; every other turn and column untouched. */
export const withAnswer = (
  turns: readonly TurnState[],
  answerId: string,
  change: (answer: AnswerState) => AnswerState,
): TurnState[] =>
  turns.map((turn) =>
    turn.answers.some((answer) => answer.id === answerId)
      ? {
          ...turn,
          answers: turn.answers.map((answer) =>
            answer.id === answerId ? change(answer) : answer,
          ),
        }
      : turn,
  );

/** A progress snapshot while the answer streams. A stopped column takes none. */
export const withProgress =
  (progress: StreamProgress) =>
  (answer: AnswerState): AnswerState =>
    answer.status !== "STREAMING"
      ? answer
      : {
          ...answer,
          text: progress.text,
          tools: progress.tools,
          views: progress.views,
          profileFrame: progress.profileFrame,
          reviewing: progress.reviewing,
        };

/** "Try again": streaming again with nothing kept. */
export const retriedAnswer = (answer: AnswerState): AnswerState =>
  streamingAnswer(answer.id, answer.modelId, answer.modelName);

/** The person pressed Stop: failed, stopped, no longer reviewing, nothing measured. */
export const stoppedAnswer = (answer: AnswerState): AnswerState =>
  answer.status !== "STREAMING"
    ? answer
    : { ...answer, status: "FAILED", stopped: true, reviewing: false, metrics: null };

/**
 * The one update after a stream ends (unless stopped): final status, lost
 * flag, refusal, metrics, document, number sources and completion time (only
 * on COMPLETE), and the reasoning and cited values parsed from the full
 * reply against the summaries read just now.
 */
export const finishedAnswer = (
  answer: AnswerState,
  result: StreamResult,
  summaries: WearableSummaries | null,
  now: Date,
): AnswerState => {
  if (answer.status !== "STREAMING") return answer;
  const complete = result.ending === "COMPLETE";
  const parsed = parseTwinAnswer(result.text, summaries);
  const { refusal: _drop, lost: _lost, ...rest } = answer;
  return {
    ...rest,
    status: complete ? "COMPLETE" : "FAILED",
    text: result.text,
    tools: result.tools,
    views: result.views,
    profileFrame: result.profileFrame,
    reviewing: false,
    ...(result.ending === "LOST" ? { lost: true } : {}),
    ...(result.refusal === null ? {} : { refusal: result.refusal }),
    metrics: complete ? result.metrics : null,
    document: result.document,
    reasoningText: parsed.reasoningText,
    attribution: parsed.attribution,
    ...(complete
      ? {
          numberSources: numberSources(result.text, result.toolParts),
          completedAt: now.toISOString(),
        }
      : {}),
  };
};

/** Answers that need a stream: streaming, and in a turn that is neither provisional nor scheduled. */
export const answersToStream = (
  turns: readonly TurnState[],
): readonly Readonly<{ turn: TurnState; answer: AnswerState }>[] =>
  turns.flatMap((turn) =>
    turn.provisional === true || turn.scheduled === true
      ? []
      : turn.answers.flatMap((answer) =>
          answer.status === "STREAMING" ? [{ turn, answer }] : [],
        ),
  );

/** Scheduled turns from a refreshed server read, in place of the screen's copies (SPEC 2.8). */
export const withScheduledFrom = (
  turns: readonly TurnState[],
  fresh: readonly TurnState[],
): TurnState[] =>
  turns.map((turn) =>
    turn.scheduled === true ? (fresh.find((each) => each.id === turn.id) ?? turn) : turn,
  );

/** Summaries as the wearables route returns them; anything else reads as none. */
export const summariesOf = (body: unknown): WearableSummaries | null => {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const pick = <K extends keyof WearableSummaries>(key: K): WearableSummaries[K] =>
    typeof record[key] === "object" && record[key] !== null
      ? (record[key] as WearableSummaries[K])
      : null;
  return {
    oura: pick("oura"),
    whoop: pick("whoop"),
    googleHealth: pick("googleHealth"),
    vitronic: pick("vitronic"),
  };
};
