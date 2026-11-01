"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { NumberSource } from "@/infrastructure/number-sources";
import { ChevronIcon } from "@/infrastructure/ui-kit/icons";
import { StatusBadge, type StatusTone } from "@/infrastructure/ui-kit/status-badge";
import { StepTrace } from "@/infrastructure/ui-kit/step-trace";

import type { AnswerStatus, ToolActivity } from "./conversation";
import { cardNumbers, sourceCallIds } from "./number-links";
import { rowsLabel, STATE_LABELS, type ToolCardState } from "./tool-cards";
import {
  answerTraceState,
  type ReviewStep,
  toolStepLabels,
  toolStepState,
} from "./tool-steps";

/**
 * The answer's tool calls as a step trace (`StepTrace`): while the answer
 * streams, the line names the call in progress and the steps list beneath
 * it; once it settles the line reads "Used N tools in X.Xs" and the list
 * folds. Each step is a compact card, folded by default: its header says
 * what the call did in plain words (`tool-steps.ts`), with its rows and
 * state; the fold-out lists every named argument, the call's title and the
 * tool's own name, for a refusal why, and the answer's numbers the call
 * holds with their rows. The same steps show while the answer streams and
 * after a reload (`tool-cards.ts`).
 *
 * A number pressed in the answer (`ActiveNumber`) opens the trace and every
 * card that holds it, and moves focus to the first; `key` changes on each
 * press, so pressing the same number again scrolls back to it.
 */

export type ActiveNumber = Readonly<{ text: string; key: number }>;

/** The id of a card's title, which a number in the answer is described by. */
export const toolCardTitleId = (idPrefix: string, toolCallId: string): string =>
  `${idPrefix}-tool-${toolCallId}`;

const TONE: Readonly<Record<ToolCardState, StatusTone>> = {
  running: "neutral",
  done: "ok",
  refused: "off",
  error: "warn",
};

type CardProps = Readonly<{
  card: ToolActivity;
  /** What the call did, in plain words: the header's text. */
  heading: string;
  numbers: readonly NumberSource[];
  titleId: string | undefined;
  /** The pressed number when this card holds it. */
  highlight: ActiveNumber | null;
  /** This is the first card that holds it: it takes focus. */
  focus: boolean;
}>;

const ToolCallCard = ({
  card,
  heading,
  numbers,
  titleId,
  highlight,
  focus,
}: CardProps) => {
  const [open, setOpen] = useState(false);
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  const header = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // A new press opens the card once; the person may fold it again after.
  if (highlight !== null && highlight.key !== openedFor) {
    setOpenedFor(highlight.key);
    setOpen(true);
  }
  const focusKey = focus && highlight !== null ? highlight.key : null;
  useEffect(() => {
    if (focusKey === null) return;
    header.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    header.current?.focus({ preventScroll: true });
  }, [focusKey]);

  const rows = rowsLabel(card.rowCount);
  const held = cardNumbers(numbers, card.id);
  return (
    <div className="tool-card" data-highlight={highlight === null ? undefined : ""}>
      <button
        ref={header}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="tool-card-header"
      >
        <ChevronIcon
          className={open ? "rotate-90 transition-transform" : "transition-transform"}
        />
        <span id={titleId} className="text-foreground min-w-0 flex-1 sm:truncate">
          {heading}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {rows !== null && (
            <span className="text-muted-foreground tabular-nums">{rows}</span>
          )}
          <StatusBadge tone={TONE[card.state]}>{STATE_LABELS[card.state]}</StatusBadge>
        </span>
      </button>
      <div id={panelId} hidden={!open} className="tool-card-body">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {card.args.map((arg) => (
            <div key={arg.label} className="contents">
              <dt className="text-muted-foreground">{arg.label}</dt>
              <dd className="min-w-0 break-words">{arg.value}</dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Call</dt>
          <dd>{card.title}</dd>
          <dt className="text-muted-foreground">Tool</dt>
          <dd className="font-mono">{card.tool}</dd>
          {rows !== null && (
            <>
              <dt className="text-muted-foreground">Read</dt>
              <dd>{rows}</dd>
            </>
          )}
        </dl>
        {card.note !== null && <p className="text-muted-foreground mt-2">{card.note}</p>}
        {held.length > 0 && (
          <div className="mt-2">
            <p className="text-muted-foreground">Numbers in the answer from this call</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {held.map((number) => (
                <li
                  key={number.text}
                  aria-current={highlight?.text === number.text ? "true" : undefined}
                  className="aria-[current=true]:bg-muted -mx-1 flex gap-2 rounded px-1"
                >
                  <span className="font-mono">{number.text}</span>
                  <span className="text-muted-foreground">{number.where}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export const ToolSteps = ({
  cards,
  status,
  workingLabel,
  numbers = [],
  active = null,
  idPrefix,
  review = null,
}: Readonly<{
  cards: readonly ToolActivity[];
  /** The answer's status: the trace settles when the answer does. */
  status: AnswerStatus;
  /** Said on the line while the answer streams and no call is running. */
  workingLabel?: string;
  /** The answer's numbers and the calls that hold them. */
  numbers?: readonly NumberSource[];
  active?: ActiveNumber | null;
  /** Gives each card title an id the answer's numbers point to. */
  idPrefix?: string;
  /** The Ultra number check (#366), the trace's last step when there is one. */
  review?: ReviewStep | null;
}>) => {
  if (cards.length === 0 && (review === null || review === undefined)) return null;
  const holders =
    active === null
      ? []
      : sourceCallIds(numbers.filter((source) => source.text === active.text));
  const labels = toolStepLabels(cards);
  const steps = cards.map((card, index) => {
    const label = labels[index] ?? card.title;
    return {
      id: card.id,
      label,
      state: toolStepState(card),
      detail: (
        <ToolCallCard
          card={card}
          heading={label}
          numbers={numbers}
          titleId={
            idPrefix === undefined ? undefined : toolCardTitleId(idPrefix, card.id)
          }
          highlight={holders.includes(card.id) ? active : null}
          focus={holders[0] === card.id}
        />
      ),
    };
  });
  const reviewSteps =
    review === null || review === undefined
      ? []
      : [
          {
            id: "number-review",
            label: review.label,
            state: review.state,
            detail:
              review.lines.length === 0 ? undefined : (
                <div className="tool-card">
                  <p className="tool-card-header text-foreground">{review.label}</p>
                  <ul className="tool-card-body flex flex-col gap-0.5">
                    {review.lines.map((line, index) => (
                      // A number can appear twice with the same verdict.
                      <li key={`${String(index)}-${line}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ),
          },
        ];
  return (
    <StepTrace
      steps={[...steps, ...reviewSteps]}
      state={answerTraceState(status)}
      workingLabel={workingLabel}
      noun={reviewSteps.length === 0 ? "tool" : "step"}
      listLabel={
        reviewSteps.length === 0 ? "Tool calls" : "Tool calls and the number check"
      }
      revealKey={active === null || holders.length === 0 ? undefined : active.key}
    />
  );
};
