"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { incognitoSessionId } from "@/infrastructure/incognito";
import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { buildUiContext, type UiState } from "@/infrastructure/ui-context";

import { type AnswerRequest, streamAnswer } from "./answer-stream";
import type { AnswerState, PromptSend, TurnState } from "./conversation";
import { historyForTurn } from "./model-history";
import { showThreadAddress } from "./screen-rules";
import { startTurn } from "./start-turn";
import { stopAnswer } from "./stop-answers";
import {
  answersToStream,
  confirmedTurn,
  finishedAnswer,
  incognitoTurn,
  provisionalTurn,
  retriedAnswer,
  scheduledStillWriting,
  stoppedAnswer,
  summariesOf,
  withAnswer,
  withProgress,
  withScheduledFrom,
  withTurnReplaced,
} from "./turn-updates";

/**
 * One conversation's state and its streams (SPEC 2.3, 2.8, 7.7–7.8, 8).
 *
 * Every column in the streaming state with no open stream gets exactly one
 * request, whether it was just sent, retried, or found still writing when a
 * saved thread opened. Provisional and scheduled turns never stream from
 * here. Stop ends only the streams this tab opened.
 */

/** Fixed sentence for a turn that could not start for an unexpected reason. */
export const TURN_DID_NOT_START = "Your prompt didn't go through. Send it again.";

/** How often a thread with a scheduled answer still being written reads its rows again. */
export const SCHEDULED_REFRESH_MS = 5_000;

type OpenStream = Readonly<{
  controller: AbortController;
  turnId: string;
  modelId: string;
}>;

type Options = Readonly<{
  threadId: string | null;
  initialTurns: readonly TurnState[];
  incognito: boolean;
  /** What is on screen now, for the on-screen context a saved turn carries. */
  uiOf: (turns: readonly TurnState[], twinOpen: boolean) => UiState;
}>;

const randomId = (): string => crypto.randomUUID();

const readSummaries = async () => {
  try {
    const response = await fetch("/api/wearables/summary");
    return response.ok ? summariesOf(await response.json()) : null;
  } catch {
    return null;
  }
};

const displayTitle = (send: PromptSend): string => send.label ?? send.prompt;

export const useConversation = ({
  threadId: initialThreadId,
  initialTurns,
  incognito,
  uiOf,
}: Options) => {
  const router = useRouter();
  const history = useThreadHistory();
  const [turns, setTurns] = useState<readonly TurnState[]>(initialTurns);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Where the twin card sits: after this many turns; null when closed. */
  const [twinAt, setTwinAt] = useState<number | null>(null);
  const open = useRef(new Map<string, OpenStream>());
  const twinOpenRef = useRef(false);
  useEffect(() => {
    twinOpenRef.current = twinAt !== null;
  }, [twinAt]);
  const turnsRef = useRef(turns);
  const uiRef = useRef(uiOf);
  useEffect(() => {
    turnsRef.current = turns;
    uiRef.current = uiOf;
  }, [turns, uiOf]);

  // A refreshed server read brings scheduled answers as they are written.
  const [seenInitial, setSeenInitial] = useState(initialTurns);
  if (seenInitial !== initialTurns) {
    setSeenInitial(initialTurns);
    setTurns((current) => withScheduledFrom(current, initialTurns));
  }

  const openStream = useCallback(
    (turn: TurnState, answer: AnswerState) => {
      const controller = new AbortController();
      open.current.set(answer.id, {
        controller,
        turnId: turn.id,
        modelId: answer.modelId,
      });
      const request: AnswerRequest = {
        modelId: answer.modelId,
        ...(incognito ? {} : { turnId: turn.id }),
        messages: historyForTurn(turnsRef.current, turn.id, answer.modelId),
        ...(turn.skill ? { skill: turn.skill } : {}),
        ...(incognito || turn.uiContext === undefined
          ? {}
          : { uiContext: turn.uiContext }),
        ...(turn.effort === undefined ? {} : { effort: turn.effort }),
      };
      void streamAnswer(
        request,
        (progress) =>
          setTurns((current) => withAnswer(current, answer.id, withProgress(progress))),
        undefined,
        { incognito, signal: controller.signal },
      ).then(async (result) => {
        const release = () => {
          if (open.current.get(answer.id)?.controller === controller) {
            open.current.delete(answer.id);
          }
        };
        if (result.aborted || controller.signal.aborted) {
          release();
          return;
        }
        // The linked wearables may have synced while the answer ran.
        const summaries = await readSummaries();
        setTurns((current) =>
          withAnswer(current, answer.id, (each) =>
            finishedAnswer(each, result, summaries, new Date()),
          ),
        );
        release();
      });
    },
    [incognito],
  );

  // One stream per streaming column that has none.
  useEffect(() => {
    for (const { turn, answer } of answersToStream(turns)) {
      if (!open.current.has(answer.id)) openStream(turn, answer);
    }
  }, [turns, openStream]);

  // A scheduled answer still being written: read the rows again until none is.
  const writing = scheduledStillWriting(turns);
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => router.refresh(), SCHEDULED_REFRESH_MS);
    return () => clearInterval(timer);
  }, [writing, router]);

  const streaming = answersToStream(turns).length > 0;

  const send = useCallback(
    async (prompt: PromptSend) => {
      setError(null);
      if (incognito) {
        setTurns((current) => [
          ...current,
          incognitoTurn(incognitoSessionId(randomId), prompt),
        ]);
        return;
      }
      const context =
        buildUiContext(uiRef.current(turnsRef.current, twinOpenRef.current)) ?? undefined;
      const provisionalId = `provisional-${randomId()}`;
      setTurns((current) => [
        ...current,
        provisionalTurn(
          provisionalId,
          prompt,
          context === undefined ? {} : { uiContext: context },
        ),
      ]);
      setSending(true);
      const result = await startTurn({
        threadId,
        prompt: prompt.prompt,
        models: prompt.models,
        skill: prompt.skill,
        label: prompt.label,
      }).catch(() => ({ ok: false as const, error: TURN_DID_NOT_START }));
      setSending(false);
      if (!result.ok) {
        setTurns((current) => withTurnReplaced(current, provisionalId, null));
        setError(result.error);
        return;
      }
      setTurns((current) => {
        const provisional = current.find((turn) => turn.id === provisionalId);
        return provisional === undefined
          ? current
          : withTurnReplaced(current, provisionalId, confirmedTurn(provisional, result));
      });
      if (threadId === null) {
        setThreadId(result.threadId);
        // No navigation: the open streams must survive.
        showThreadAddress(result.threadId);
      }
      history.noteThreadTouched({
        id: result.threadId,
        title:
          threadId === null
            ? result.threadTitle || displayTitle(prompt)
            : result.threadTitle,
        modelCount: prompt.models.length,
      });
    },
    [history, incognito, threadId],
  );

  const stop = useCallback(() => {
    const streams = [...open.current.entries()];
    open.current.clear();
    for (const [, stream] of streams) stream.controller.abort();
    setTurns((current) =>
      streams.reduce<readonly TurnState[]>(
        (all, [answerId]) => withAnswer(all, answerId, stoppedAnswer),
        current,
      ),
    );
    if (incognito) return;
    for (const [, stream] of streams) {
      void stopAnswer({ turnId: stream.turnId, modelId: stream.modelId });
    }
  }, [incognito]);

  const retry = useCallback((answerId: string) => {
    setTurns((current) => withAnswer(current, answerId, retriedAnswer));
  }, []);

  const openTwin = useCallback(() => {
    setTwinAt((at) => at ?? turnsRef.current.length);
  }, []);

  return {
    turns,
    threadId,
    sending,
    streaming,
    error,
    twinAt,
    send,
    stop,
    retry,
    openTwin,
    closeTwin: () => setTwinAt(null),
  };
};

export type Conversation = ReturnType<typeof useConversation>;
