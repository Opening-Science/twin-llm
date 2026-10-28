"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { Command } from "@/features/commands/registry";
import { INCOGNITO_HREF, NEW_CHAT_HREF } from "@/infrastructure/incognito";
import type { CatalogModel } from "@/infrastructure/model-catalog";

import { AnswerColumn } from "./answer-column";
import type { TurnState } from "./conversation";
import { IncognitoBanner } from "./incognito-controls";
import { OutputsPanel } from "./outputs-panel";
import { PromptBar } from "./prompt-bar";
import { useSuggestedQuestions } from "./suggestion-chips";
import { threadOutputs } from "./thread-outputs";
import { conversationItems } from "./twin-card-state";
import { TwinChatCard } from "./twin-chat-card";
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
 * was opened. It is not a turn, so no model ever sees it.
 * A new chat can be incognito (`/?incognito=1`, `infrastructure/incognito.ts`):
 * the conversation stays in this screen's state, only local models are
 * offered, and the banner and a dashed prompt bar say so throughout.
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
  const items = useMemo(() => conversationItems(turns, twin.card), [turns, twin.card]);
  const suggestions = useSuggestedQuestions(
    threadId === null && turns.length === 0,
    subjectRef,
  );
  const outputs = useMemo(() => threadOutputs(turns), [turns]);
  const [largeOutput, setLargeOutput] = useState(false);
  const withPanel = outputs.length > 0;

  return (
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
            <OutputsPanel entries={outputs} onLargeChange={setLargeOutput} />
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
                        {item.turn.skill ? (
                          <span className="skill-chip">
                            <span className="sr-only">Sent with the skill </span>
                            {`/${item.turn.skill}`}
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
        onSubmit={(prompt, models, skill) => void send(prompt, models, skill)}
        onTwin={twin.open}
      />
    </div>
  );
};
