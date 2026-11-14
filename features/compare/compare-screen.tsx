"use client";

import { useState } from "react";

import type { Command } from "@/features/commands/registry";
import { CompactDraftCard } from "@/features/memory/compact-draft-card";
import { useCompactNote } from "@/features/memory/use-compact-note";
import type { CatalogModel } from "@/infrastructure/model-catalog";
import { cn } from "@/infrastructure/ui";
import type { UiState } from "@/infrastructure/ui-context";
import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

import type { ChatSettings, PromptSourceFacts, TurnState } from "./conversation";
import { ConversationView } from "./conversation-view";
import { EmptyState, IncognitoBanner } from "./empty-state";
import { outputEntriesOf, OutputsPanel, useOutputsMode } from "./outputs-panel";
import { PromptBar } from "./prompt-bar";
import { lastTurnEffort, lastTurnModelIds } from "./screen-rules";
import { TwinCard } from "./twin-card";
import { useConversation } from "./use-conversation";

/**
 * The side-by-side screen (SPEC 1–3), for a new chat and a saved thread
 * alike: the conversation, the Outputs panel beside it from the extra-large
 * breakpoint once any answer drew a view, and the prompt bar sticky at the
 * bottom.
 */

export type CompareScreenProps = Readonly<
  {
    catalog: readonly CatalogModel[] | null;
    threadId?: string;
    initialTurns?: readonly TurnState[];
    skills: readonly Command[];
    sourceFacts: PromptSourceFacts;
    incognito?: boolean;
    localModelIds?: readonly string[];
    initialDraft?: string;
    subjectRef?: string;
  } & ChatSettings
>;

const NO_TURNS: readonly TurnState[] = Object.freeze([]);
const NO_IDS: readonly string[] = Object.freeze([]);

export const CompareScreen = ({
  catalog,
  threadId,
  initialTurns = NO_TURNS,
  skills,
  sourceFacts,
  incognito = false,
  localModelIds = NO_IDS,
  initialDraft,
  subjectRef,
  dataMode,
  bodyLoopConfigured,
}: CompareScreenProps) => {
  const [outputsMode, setOutputsMode] = useOutputsMode();
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [organ, setOrgan] = useState<TwinFocusId | null>(null);
  const uiOf = (current: readonly TurnState[], twinOpen: boolean): UiState => {
    const views = outputEntriesOf(current).map((entry) => entry.view);
    return {
      outputsOpen: views.length > 0 && outputsMode === "open",
      twinOpen,
      organ,
      largeView: views.find((view) => view.id === enlargedId) ?? null,
      views,
    };
  };
  const conversation = useConversation({
    threadId: threadId ?? null,
    initialTurns,
    incognito,
    uiOf,
  });
  const { turns, twinAt } = conversation;
  const entries = outputEntriesOf(turns);
  const compact = useCompactNote(conversation.threadId, incognito);

  const hasPanel = entries.length > 0;
  const enlarged =
    hasPanel &&
    outputsMode === "open" &&
    entries.some((entry) => entry.view.id === enlargedId);
  const empty = turns.length === 0 && twinAt === null;
  const pickOrgan = (picked: TwinFocusId) => setOrgan(picked);

  return (
    <div className="flex min-h-full flex-col">
      <div
        className={cn(
          "mx-auto w-full flex-1 px-(--page-gutter) pt-(--page-block) pb-6",
          "max-w-[calc(var(--page-wide)+2*var(--page-gutter))]",
          hasPanel &&
            (enlarged
              ? "xl:grid xl:max-w-[calc(var(--page-wide)+31.5rem+2*var(--page-gutter))] xl:grid-cols-[minmax(0,1fr)_30rem] xl:items-start xl:gap-6"
              : "xl:grid xl:max-w-[calc(var(--page-wide)+19.5rem+2*var(--page-gutter))] xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-6"),
        )}
      >
        {hasPanel ? (
          <div className="xl:col-start-2 xl:row-start-1">
            <OutputsPanel
              entries={entries}
              mode={outputsMode}
              onMode={setOutputsMode}
              enlargedId={enlargedId}
              onEnlarge={setEnlargedId}
              onOrganPick={pickOrgan}
            />
          </div>
        ) : null}
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          {empty ? (
            <EmptyState incognito={incognito} showToggle={threadId === undefined} />
          ) : (
            <ConversationView
              turns={turns}
              catalog={catalog}
              twinAt={twinAt}
              twinCard={
                <TwinCard
                  threadId={conversation.threadId}
                  dataMode={dataMode}
                  bodyLoopConfigured={bodyLoopConfigured}
                  prompts={turns.map((turn) => turn.prompt)}
                  onClose={conversation.closeTwin}
                  onOrganPick={pickOrgan}
                />
              }
              banner={incognito ? <IncognitoBanner /> : null}
              compactCard={
                compact.card === null ? null : (
                  <CompactDraftCard
                    state={compact.card}
                    onSaved={compact.saved}
                    onClose={compact.close}
                  />
                )
              }
              error={conversation.error}
              onRetry={conversation.retry}
              onOrganPick={pickOrgan}
            />
          )}
          {empty && conversation.error !== null ? (
            <p role="alert" className="text-destructive mt-6 text-center text-sm">
              {conversation.error}
            </p>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          "bg-background/80 sticky bottom-0 z-10 px-(--page-gutter) pb-3 backdrop-blur",
          hasPanel &&
            (enlarged ? "xl:pr-[calc(30rem+3rem)]" : "xl:pr-[calc(18rem+3rem)]"),
        )}
      >
        <div className="mx-auto w-full max-w-(--page-wide)">
          <PromptBar
            catalog={catalog}
            incognito={incognito}
            localModelIds={localModelIds}
            skills={skills}
            sourceFacts={sourceFacts}
            {...(initialDraft === undefined ? {} : { initialDraft })}
            {...(subjectRef === undefined ? {} : { subjectRef })}
            lastTurnModelIds={lastTurnModelIds(initialTurns)}
            initialEffort={lastTurnEffort(initialTurns)}
            showSuggestions={turns.length === 0}
            sending={conversation.sending}
            streaming={conversation.streaming}
            onSend={(send) => void conversation.send(send)}
            onStop={conversation.stop}
            onTwin={conversation.openTwin}
            onCompact={compact.open}
          />
        </div>
      </div>
    </div>
  );
};
