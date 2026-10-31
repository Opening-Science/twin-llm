"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import type { Command } from "@/features/commands/registry";
import { CompactDraftCard } from "@/features/memory/compact-draft-card";
import { useCompactNote } from "@/features/memory/use-compact-note";
import { INCOGNITO_HREF, NEW_CHAT_HREF } from "@/infrastructure/incognito";
import type { ChatView } from "@/infrastructure/chat-view";
import type { CatalogModel } from "@/infrastructure/model-catalog";
import { buildUiContext } from "@/infrastructure/ui-context";
import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

import { AnswerColumn } from "./answer-column";
import type { TurnState } from "./conversation";
import { IncognitoBanner } from "./incognito-controls";
import { OutputsPanel } from "./outputs-panel";
import { PromptBar } from "./prompt-bar";
import { useSuggestedQuestions } from "./suggestion-chips";
import { threadOutputs } from "./thread-outputs";
import { conversationItems } from "./twin-card-state";
import { TwinChatCard } from "./twin-chat-card";
import { TwinPickContext } from "./twin-pick-context";
import type { TwinDataMode } from "./twin-subject";
import { useConversation } from "./use-conversation";
import { useTwinCard } from "./use-twin-card";
import { Welcome } from "./welcome";

/**
 * TwinLLM's main screen: a prompt goes to one to three models and their
 * answers sit side by side, each with its reasoning, evidence and measured
 * numbers. The same screen serves a new thread at `/` and a saved one at
 * `/t/<id>`; only the starting turns differ.
 *
 * Saved threads reach this screen only for their owner (see
 * `owned-thread.ts`), so there is no read-only mode here. Once an answer
 * shows a chart, the Outputs panel lists the thread's charts beside it.
 *
 * `/twin` adds the twin card to the list, after the turns there were when it
 * was opened. It is not a turn, so no model ever sees it. `/compact` shows a
 * draft twin note under the conversation (#43); it is not a turn either.
 * A new chat can be incognito (`/?incognito=1`, `infrastructure/incognito.ts`):
 * the conversation stays in this screen's state, only local models are
 * offered, and the banner and a dashed prompt bar say so throughout.
 *
 * Each saved turn carries a UI context (#47, `infrastructure/ui-context.ts`):
 * the open panels, the organ last clicked on a twin, the chart drawn large and
 * the thread's views. It is built when the prompt is sent.
 */

/** three.js arrives with the first open card, not with the chat. */
const TwinCardViewer = dynamic(
  () => import("./twin-card-viewer").then((mod) => mod.TwinCardViewer),
  {
    ssr: false,
    loading: () => <p className="twin-chat-status">Loading the digital twin…</p>,
  },
);

const columnsClass = (count: number): string =>
  count >= 3 ? "lg:grid-cols-3" : count === 2 ? "lg:grid-cols-2" : "";

export const CompareScreen = ({
  catalog,
  defaultModelIds,
  threadId = null,
  initialTurns = [],
  skills = [],
  dataMode,
  incognito = false,
  localModelIds = [],
  initialDraft,
  subjectRef,
}: Readonly<{
  catalog: readonly CatalogModel[] | null;
  defaultModelIds: readonly string[];
  threadId?: string | null;
  initialTurns?: readonly TurnState[];
  /** Skills the server offers, listed in the palette. */
  skills?: readonly Command[];
  /** The server's DATA_MODE: which twin `/twin` shows. */
  dataMode: TwinDataMode;
  /** A new chat that is never saved; only the home page sets it. */
  incognito?: boolean;
  /** Catalog models that run on this machine, the only ones incognito offers. */
  localModelIds?: readonly string[];
  /** A `/command ` to start the prompt with, from the search box. */
  initialDraft?: string;
  /** A subject page's subject: the suggestions are about it. */
  subjectRef?: string;
}>) => {
  const router = useRouter();
  const {
    threadId: currentThreadId,
    turns,
    sending,
    error,
    summaries,
    send,
    retry,
  } = useConversation(threadId, initialTurns, incognito ? "incognito" : "saved");
  const twin = useTwinCard({
    initialThreadId: threadId,
    threadId: currentThreadId,
    turns,
    mode: dataMode,
  });
  const compact = useCompactNote(currentThreadId, incognito);
  const items = useMemo(() => conversationItems(turns, twin.card), [turns, twin.card]);
  const suggestions = useSuggestedQuestions(
    threadId === null && turns.length === 0,
    subjectRef,
  );
  const outputs = useMemo(() => threadOutputs(turns), [turns]);
  const [largeOutput, setLargeOutput] = useState(false);
  const withPanel = outputs.length > 0;
  const [outputsShown, setOutputsShown] = useState<
    Readonly<{ open: boolean; large: ChatView | null }>
  >({ open: false, large: null });
  const [organ, setOrgan] = useState<TwinFocusId | null>(null);
  const onSubmit = useCallback(
    (prompt: string, models: Parameters<typeof send>[1], skill: string | null) => {
      const uiContext = incognito
        ? null
        : buildUiContext({
            outputsOpen: withPanel && outputsShown.open,
            twinOpen: twin.card !== null && !twin.card.collapsed,
            organ,
            largeView: withPanel ? outputsShown.large : null,
            views: outputs.map((entry) => entry.view),
          });
      void send(prompt, models, skill, uiContext);
    },
    [send, incognito, withPanel, outputsShown, twin.card, organ, outputs],
  );

  return (
    <TwinPickContext value={setOrgan}>
      <div className="flex flex-1 flex-col">
        <div
          className={
            withPanel
              ? `flex-1 px-4 py-6 sm:px-6 xl:grid xl:items-start xl:gap-6 ${largeOutput ? "xl:grid-cols-[minmax(0,1fr)_30rem]" : "xl:grid-cols-[minmax(0,1fr)_18rem]"}`
              : "flex-1 px-4 py-6 sm:px-6"
          }
        >
          {withPanel && (
            <div className="xl:col-start-2 xl:row-start-1 xl:self-stretch">
              <OutputsPanel
                entries={outputs}
                onLargeChange={setLargeOutput}
                onShownChange={setOutputsShown}
              />
            </div>
          )}
          <div className="min-w-0 xl:col-start-1 xl:row-start-1">
            {items.length === 0 ? (
              <Welcome
                incognito={incognito}
                onToggleIncognito={
                  threadId === null
                    ? () => router.push(incognito ? NEW_CHAT_HREF : INCOGNITO_HREF)
                    : undefined
                }
              />
            ) : (
              <>
                <h1 className="sr-only">{turns[0]?.prompt ?? "TwinLLM"}</h1>
                {incognito ? (
                  <div className="mx-auto mb-6 max-w-5xl">
                    <IncognitoBanner />
                  </div>
                ) : null}
                <ol
                  aria-label="Answers in this thread"
                  className="mx-auto flex max-w-5xl flex-col gap-10"
                >
                  {items.map((item) =>
                    item.kind === "twin" ? (
                      <li key="twin-card">
                        <TwinChatCard
                          ref={twin.cardRef}
                          label={twin.label}
                          collapsed={item.card.collapsed}
                          onCollapse={twin.collapse}
                          onExpand={twin.expand}
                          onClose={twin.close}
                        >
                          {twin.target === null ? (
                            <p className="twin-chat-status">
                              Finding the thread&rsquo;s subject…
                            </p>
                          ) : (
                            <TwinCardViewer
                              key={twin.targetKey}
                              target={twin.target}
                              onShown={twin.onShown}
                            />
                          )}
                        </TwinChatCard>
                      </li>
                    ) : (
                      <li key={item.turn.id} className="flex flex-col gap-4">
                        <h2 className="sr-only">Prompt {item.index + 1}</h2>
                        <div className="bg-muted ml-auto flex max-w-[85%] flex-col items-start gap-1.5 rounded-2xl rounded-br-md px-4 py-3 sm:max-w-[70%]">
                          {item.turn.skill || item.turn.scheduled ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              {item.turn.scheduled ? (
                                <span className="skill-chip">Scheduled</span>
                              ) : null}
                              {item.turn.skill ? (
                                <span className="skill-chip">
                                  <span className="sr-only">Sent with the skill </span>
                                  {`/${item.turn.skill}`}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                            {item.turn.prompt}
                          </p>
                        </div>
                        <div
                          className={`surface divide-border grid grid-cols-1 divide-y overflow-hidden lg:divide-x lg:divide-y-0 ${columnsClass(item.turn.answers.length)}`}
                        >
                          {item.turn.answers.map((response) => (
                            <AnswerColumn
                              key={response.id}
                              response={response}
                              prompt={item.turn.prompt}
                              wearables={summaries}
                              onRetry={() => retry(response.id)}
                            />
                          ))}
                        </div>
                      </li>
                    ),
                  )}
                </ol>
              </>
            )}
            {compact.card !== null && (
              <div className="mx-auto mt-6 max-w-5xl">
                <CompactDraftCard
                  key={compact.card.kind}
                  state={compact.card}
                  onSaved={compact.saved}
                  onClose={compact.close}
                />
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="text-destructive mx-auto mt-6 max-w-5xl text-center text-sm"
              >
                {error}
              </p>
            )}
          </div>
        </div>
        <PromptBar
          catalog={catalog}
          initialModelIds={defaultModelIds}
          busy={sending}
          skills={skills}
          incognito={incognito}
          localModelIds={localModelIds}
          suggestions={suggestions}
          initialDraft={initialDraft}
          onSubmit={onSubmit}
          onTwin={twin.open}
          onCompact={compact.open}
        />
      </div>
    </TwinPickContext>
  );
};
