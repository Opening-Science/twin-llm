"use client";

import { useMemo, useState } from "react";

import type { Command } from "@/features/commands/registry";
import type { CatalogModel } from "@/infrastructure/model-catalog";

import { AnswerColumn } from "./answer-column";
import type { TurnState } from "./conversation";
import { OutputsPanel } from "./outputs-panel";
import { PromptBar } from "./prompt-bar";
import { threadOutputs } from "./thread-outputs";
import { useConversation } from "./use-conversation";

/**
 * TwinLLM's main screen: a prompt goes to one to three models and their
 * answers sit side by side, each with its reasoning, evidence and measured
 * numbers. The same screen serves a new thread at `/` and a saved one at
 * `/t/<id>`; only the starting turns differ.
 *
 * Saved threads reach this screen only for their owner (see
 * `owned-thread.ts`), so there is no read-only mode here. Once an answer
 * shows a chart, the Outputs panel lists the thread's charts beside it.
 */

const Welcome = () => (
  <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-2 pt-[12vh] text-center">
    <h1 className="text-display">TwinLLM</h1>
    <p className="text-muted-foreground text-[15px] leading-relaxed">
      Ask a research question, with wearable context if you link a device. Up to three
      open models answer side by side; open any answer to see its reasoning and which
      metrics it cited. Research use and visualisation only.
    </p>
  </div>
);

const columnsClass = (count: number): string =>
  count >= 3 ? "lg:grid-cols-3" : count === 2 ? "lg:grid-cols-2" : "";

export const CompareScreen = ({
  catalog,
  defaultModelIds,
  threadId = null,
  initialTurns = [],
  skills = [],
}: Readonly<{
  catalog: readonly CatalogModel[] | null;
  defaultModelIds: readonly string[];
  threadId?: string | null;
  initialTurns?: readonly TurnState[];
  /** Skills the server offers, listed in the palette. */
  skills?: readonly Command[];
}>) => {
  const { turns, sending, error, summaries, send, retry } = useConversation(
    threadId,
    initialTurns,
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
          {turns.length === 0 ? (
            <Welcome />
          ) : (
            <>
              <h1 className="sr-only">{turns[0]?.prompt}</h1>
              <ol
                aria-label="Answers in this thread"
                className="mx-auto flex max-w-5xl flex-col gap-10"
              >
                {turns.map((turn, index) => (
                  <li key={turn.id} className="flex flex-col gap-4">
                    <h2 className="sr-only">Prompt {index + 1}</h2>
                    <div className="bg-muted ml-auto flex max-w-[85%] flex-col items-start gap-1.5 rounded-2xl rounded-br-md px-4 py-3 sm:max-w-[70%]">
                      {turn.skill ? (
                        <span className="skill-chip">
                          <span className="sr-only">Sent with the skill </span>
                          {`/${turn.skill}`}
                        </span>
                      ) : null}
                      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                        {turn.prompt}
                      </p>
                    </div>
                    <div
                      className={`surface divide-border grid grid-cols-1 divide-y overflow-hidden lg:divide-x lg:divide-y-0 ${columnsClass(turn.answers.length)}`}
                    >
                      {turn.answers.map((response) => (
                        <AnswerColumn
                          key={response.id}
                          response={response}
                          wearables={summaries}
                          onRetry={() => retry(response.id)}
                        />
                      ))}
                    </div>
                  </li>
                ))}
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
        onSubmit={(prompt, models, skill) => void send(prompt, models, skill)}
      />
    </div>
  );
};
