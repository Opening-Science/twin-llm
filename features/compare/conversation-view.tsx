"use client";

import type { ReactNode } from "react";

import type { CatalogModel } from "@/infrastructure/model-catalog";
import { cn } from "@/infrastructure/ui";
import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

import { AnswerColumn } from "./answer-column";
import type { TurnState } from "./conversation";
import { displayText, pageHeading } from "./screen-rules";

/**
 * The conversation itself (SPEC 3.1, 3.2, 11): an ordered list of turns,
 * each the person's bubble then one card of answer columns, with the twin
 * card as an item where it was opened, then the twin-note draft and the
 * turn-level error. The page frame (Outputs panel grid, sticky prompt bar)
 * is the screen's.
 */

/** Columns side by side from the large breakpoint: one, two or three. */
const GRID: Readonly<Record<number, string>> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
};

export const PromptBubble = ({ turn }: Readonly<{ turn: TurnState }>) => (
  <div className="bg-muted ml-auto flex max-w-[85%] flex-col gap-1.5 rounded-2xl rounded-br-md px-4 py-2.5 sm:max-w-[70%]">
    {turn.scheduled === true || turn.skill ? (
      <div className="flex flex-wrap gap-1.5">
        {turn.scheduled === true ? <span className="skill-chip">Scheduled</span> : null}
        {turn.skill ? (
          <span className="skill-chip">
            <span className="sr-only">sent with the skill </span>/{turn.skill}
          </span>
        ) : null}
      </div>
    ) : null}
    <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
      {displayText(turn)}
    </p>
  </div>
);

const TurnItem = ({
  turn,
  index,
  catalog,
  onRetry,
  onOrganPick,
}: Readonly<{
  turn: TurnState;
  index: number;
  catalog: readonly CatalogModel[] | null;
  onRetry: (answerId: string) => void;
  onOrganPick?: (organ: TwinFocusId) => void;
}>) => (
  <li className="flex flex-col gap-4">
    <h2 className="sr-only">Prompt {String(index + 1)}</h2>
    <PromptBubble turn={turn} />
    <div
      className={cn(
        "surface divide-border grid grid-cols-1 divide-y overflow-hidden lg:divide-x lg:divide-y-0",
        GRID[Math.min(Math.max(turn.answers.length, 1), 3)],
      )}
    >
      {turn.answers.map((answer) => (
        <AnswerColumn
          key={answer.id}
          answer={answer}
          prompt={turn.prompt}
          catalog={catalog}
          onRetry={() => onRetry(answer.id)}
          {...(onOrganPick === undefined ? {} : { onOrganPick })}
        />
      ))}
    </div>
  </li>
);

export const ConversationView = ({
  turns,
  catalog,
  twinAt,
  twinCard,
  banner,
  compactCard,
  error,
  onRetry,
  onOrganPick,
}: Readonly<{
  turns: readonly TurnState[];
  catalog: readonly CatalogModel[] | null;
  /** The twin card sits after this many turns; null when closed. */
  twinAt: number | null;
  twinCard: ReactNode;
  /** The incognito banner, above the answers once there are some. */
  banner: ReactNode;
  compactCard: ReactNode;
  error: string | null;
  onRetry: (answerId: string) => void;
  onOrganPick?: (organ: TwinFocusId) => void;
}>) => {
  const twinItem =
    twinAt === null ? null : (
      <li key="twin-card" className="flex flex-col">
        {twinCard}
      </li>
    );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="sr-only">{pageHeading(turns)}</h1>
      {banner}
      <ol aria-label="Answers in this thread" className="flex flex-col gap-10">
        {turns.flatMap((turn, index) => [
          ...(twinAt === index ? [twinItem] : []),
          <TurnItem
            key={turn.id}
            turn={turn}
            index={index}
            catalog={catalog}
            onRetry={onRetry}
            {...(onOrganPick === undefined ? {} : { onOrganPick })}
          />,
        ])}
        {twinAt !== null && twinAt >= turns.length ? twinItem : null}
      </ol>
      {compactCard}
      {error === null ? null : (
        <p role="alert" className="text-destructive text-center text-sm">
          {error}
        </p>
      )}
    </div>
  );
};
