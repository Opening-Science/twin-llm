"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseTwinAnswer,
  type WearableSummaries,
} from "@/infrastructure/parse-twin-answer";
import { useThreadHistory } from "@/infrastructure/thread-history-store";
import type { UiContext } from "@/infrastructure/ui-context";

import { streamAnswer } from "./answer-stream";
import {
  answerRequestFor,
  beginTurn,
  type BeginTurnDeps,
  type ConversationMode,
} from "./begin-turn";
import type { TurnState } from "./conversation";
import { startTurn } from "./start-turn";
import { historyFor } from "./turn-history";
import {
  answersToStream,
  confirmTurn,
  dropPending,
  pendingTurn,
  restartResponse,
  updateResponse,
} from "./turn-updates";

/**
 * The compare screen's state and side effects in one place: sending a prompt,
 * one `/api/chat` stream per answer, retries, and the wearable summaries the
 * answers are read against.
 *
 * Two rules hold everything together:
 * - An answer row in STREAMING with no open stream gets one. That single rule
 *   covers a fresh send, a retry, and a saved thread opened while its answers
 *   are still being written (onboarding starts threads that way).
 * - Nothing here navigates. A new thread's URL is set with `replaceState`, so
 *   the open streams are not torn down by a route change.
 *
 * In incognito mode (`begin-turn.ts`) the turns live in this state only:
 * `startTurn` is never called, the thread history is not touched and the URL
 * stays as it is, so a reload or a new chat discards the conversation.
 */

const NO_SUMMARIES: WearableSummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

const fetchSummaries = async (): Promise<WearableSummaries> => {
  try {
    const response = await fetch("/api/wearables/summary");
    if (!response.ok) return NO_SUMMARIES;
    const body = (await response.json()) as Partial<WearableSummaries>;
    return {
      oura: body.oura ?? null,
      whoop: body.whoop ?? null,
      googleHealth: body.googleHealth ?? null,
      vitronic: body.vitronic ?? null,
    };
  } catch {
    return NO_SUMMARIES;
  }
};

const SEND_FAILED = "That prompt didn't go through. Try sending it again.";

const BEGIN_TURN: BeginTurnDeps = {
  startTurn,
  randomId: () => crypto.randomUUID(),
};

export type SendModel = Readonly<{ id: string; name: string }>;

export const useConversation = (
  initialThreadId: string | null,
  initialTurns: readonly TurnState[],
  mode: ConversationMode = "saved",
) => {
  const { noteThreadTouched } = useThreadHistory();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [turns, setTurns] = useState<readonly TurnState[]>(initialTurns);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<WearableSummaries>(NO_SUMMARIES);
  const streaming = useRef(new Set<string>());

  useEffect(() => {
    let current = true;
    void fetchSummaries().then((fresh) => {
      if (current) setSummaries(fresh);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    answersToStream(turns, streaming.current).forEach(
      ({ turnIndex, turnId, skill, uiContext, response }) => {
        streaming.current.add(response.id);
        const request = answerRequestFor(mode, {
          modelId: response.modelId,
          turnId,
          messages: historyFor(turns, turnIndex, response.modelId),
          skill,
          uiContext,
        });
        void streamAnswer(request, (progress) =>
          setTurns((all) =>
            updateResponse(all, response.id, (answer) => ({ ...answer, ...progress })),
          ),
        ).then(async (result) => {
          // Wearable data may have synced while the model worked; the evidence
          // panel reads the answer against what is current now.
          const fresh = await fetchSummaries();
          // Freed only now, in the same update as the final status: freed any
          // earlier, a render in between would open a second stream for an
          // answer that has already finished.
          streaming.current.delete(response.id);
          setSummaries(fresh);
          setTurns((all) =>
            updateResponse(all, response.id, (answer) => {
              const parsed = parseTwinAnswer(answer.text, fresh);
              return {
                ...answer,
                status: result.ending === "COMPLETE" ? "COMPLETE" : "FAILED",
                lost: result.ending === "LOST",
                refusal: result.refusal,
                metrics: result.metrics,
                document: result.document,
                numberSources: result.numberSources ?? [],
                completedAt:
                  result.ending === "COMPLETE" ? new Date().toISOString() : null,
                reasoningText: parsed.reasoningText,
                attribution: parsed.attribution,
              };
            }),
          );
        });
      },
    );
  }, [turns, mode]);

  const send = useCallback(
    async (
      prompt: string,
      models: readonly SendModel[],
      skill: string | null = null,
      uiContext: UiContext | null = null,
    ) => {
      setSending(true);
      setError(null);
      setTurns((all) => [...all, pendingTurn(prompt, models, skill, uiContext)]);

      const started = await beginTurn(mode, BEGIN_TURN, {
        threadId,
        prompt,
        models,
        skill,
      }).catch((thrown: unknown) => {
        console.error(
          "[arena] could not start the turn",
          thrown instanceof Error ? thrown.name : typeof thrown,
        );
        return { ok: false, error: SEND_FAILED } as const;
      });
      setSending(false);
      if (!started.ok) {
        setTurns(dropPending);
        setError(started.error);
        return;
      }

      setTurns((all) => confirmTurn(all, started.turnId, started.responses));
      if (started.kind === "incognito") return;
      noteThreadTouched({
        id: started.threadId,
        title: started.threadTitle,
        modelCount: models.length,
      });
      if (threadId === null) {
        setThreadId(started.threadId);
        // A null state lets Next.js adopt the new URL, so the header and
        // sidebar see `/t/<id>` without a navigation.
        window.history.replaceState(null, "", `/t/${started.threadId}`);
      }
    },
    [threadId, noteThreadTouched, mode],
  );

  const retry = useCallback(
    (responseId: string) =>
      setTurns((all) => updateResponse(all, responseId, restartResponse)),
    [],
  );

  return { threadId, turns, sending, error, summaries, send, retry };
};
