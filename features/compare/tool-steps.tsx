"use client";

import { useEffect, useId, useState } from "react";

import {
  NUMBER_REVIEWER,
  type NumberReview,
  reviewItemLine,
  reviewStepLabel,
} from "@/infrastructure/number-review";
import { ChevronIcon } from "@/infrastructure/ui-kit/icons";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";
import { StepTrace, type StepTraceStep } from "@/infrastructure/ui-kit/step-trace";
import type { TraceState } from "@/infrastructure/ui-kit/step-trace-model";
import { cn } from "@/infrastructure/ui";

import { cardBadge, stepStateOf } from "./column-lines";
import type { ToolCard } from "./conversation";
import type { CallNumber } from "./number-links";
import { rowCountText, sharedMeasureNames, stepLine } from "./tool-cards";

/**
 * The steps an answer took (SPEC 5.3): one trace per column, its tool calls
 * as cards folded by default, and the Ultra number check as the last step.
 * A number pressed in the answer (`reveal`) opens the trace and every card
 * that holds it, highlights them, and moves focus to the first card's header.
 */

export const NUMBER_CHECK_RUNNING = "Checking each number against the tool results";

/** The ids a card's parts carry, so a number in the answer can point at them. */
export const cardHeaderId = (prefix: string, cardId: string): string =>
  `${prefix}-card-${cardId}-header`;
export const cardTitleId = (prefix: string, cardId: string): string =>
  `${prefix}-card-${cardId}-title`;

/** A number pressed in the answer: the calls that hold it. `key` changes per press. */
export type Reveal = Readonly<{
  key: number;
  number: string;
  callIds: readonly string[];
}>;

export type NumberCheck = Readonly<{ running: boolean; review: NumberReview | null }>;

const Fact = ({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) => (
  <div className="flex min-w-0 gap-2">
    <dt className="text-muted-foreground w-20 shrink-0">{label}</dt>
    <dd className={cn("min-w-0 break-words", mono && "font-mono")}>{value}</dd>
  </div>
);

const ToolCardView = ({
  prefix,
  card,
  line,
  open,
  onToggle,
  highlighted,
  numbers,
  currentNumber,
}: Readonly<{
  prefix: string;
  card: ToolCard;
  line: string;
  open: boolean;
  onToggle: () => void;
  highlighted: boolean;
  numbers: readonly CallNumber[];
  currentNumber: string | null;
}>) => {
  const bodyId = useId();
  const badge = cardBadge(card);
  const rows = rowCountText(card.rowCount);
  return (
    <div className="compare-tool-card" data-highlight={highlighted ? "" : undefined}>
      <button
        type="button"
        id={cardHeaderId(prefix, card.id)}
        className="compare-tool-card-header"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <ChevronIcon className={cn("transition-transform", open && "rotate-90")} />
        <span id={cardTitleId(prefix, card.id)} className="min-w-0 flex-1 truncate">
          {line}
        </span>
        {rows === null ? null : (
          <span className="text-muted-foreground shrink-0 font-mono">{rows}</span>
        )}
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </button>
      <div id={bodyId} hidden={!open} className="compare-tool-card-body">
        <dl className="flex flex-col gap-1">
          {card.args.map((arg) => (
            <Fact key={arg.label} label={arg.label} value={arg.value} />
          ))}
          <Fact label="Call" value={card.title} />
          <Fact label="Tool" value={card.tool} mono />
          {rows === null ? null : <Fact label="Read" value={rows} />}
          {card.state === "refused" && card.code !== undefined ? (
            <Fact label="Result code" value={card.code} mono />
          ) : null}
        </dl>
        {numbers.length === 0 ? null : (
          <div className="mt-2 flex flex-col gap-1">
            <p className="text-muted-foreground">Numbers in the answer from this call</p>
            <ul className="flex flex-col gap-0.5">
              {numbers.map((number) => {
                const current = highlighted && number.text === currentNumber;
                return (
                  <li
                    key={number.text}
                    aria-current={current ? "true" : undefined}
                    className={cn(current && "text-foreground font-medium")}
                  >
                    <span className="font-mono">{number.text}</span>
                    {number.where === "" ? null : (
                      <span className="text-muted-foreground"> · {number.where}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

const NumberCheckDetail = ({ review }: Readonly<{ review: NumberReview }>) => (
  <div className="compare-tool-card">
    <div className="compare-tool-card-body flex flex-col gap-1 border-t-0">
      <p>{reviewStepLabel(review)}</p>
      {review.refusal === undefined ? null : <p>{review.refusal}</p>}
      {review.items.length === 0 ? null : (
        <ul className="flex flex-col gap-0.5">
          {review.items.map((item, index) => (
            <li key={`${item.text}-${String(index)}`}>{reviewItemLine(item)}</li>
          ))}
        </ul>
      )}
      {review.skipped === 0 ? null : (
        <p>
          {review.skipped === 1
            ? "1 more number was not checked."
            : `${String(review.skipped)} more numbers were not checked.`}
        </p>
      )}
      <p className="text-muted-foreground">
        Checked by {NUMBER_REVIEWER.name}, a model that can be wrong.
      </p>
    </div>
  </div>
);

export const ToolSteps = ({
  prefix,
  tools,
  state,
  workingLabel,
  numberCheck,
  numbersByCall,
  reveal,
}: Readonly<{
  /** Unique per column, so card ids do not collide across columns. */
  prefix: string;
  tools: readonly ToolCard[];
  state: TraceState;
  workingLabel: string;
  numberCheck: NumberCheck | null;
  numbersByCall: ReadonlyMap<string, readonly CallNumber[]>;
  reveal: Reveal | null;
}>) => {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [seenReveal, setSeenReveal] = useState<number | null>(null);
  if (reveal !== null && reveal.key !== seenReveal) {
    setSeenReveal(reveal.key);
    setOpen((was) => new Set([...was, ...reveal.callIds]));
  }

  useEffect(() => {
    if (reveal === null) return;
    const first = reveal.callIds.find((id) => tools.some((card) => card.id === id));
    if (first === undefined) return;
    const header = document.getElementById(cardHeaderId(prefix, first));
    header?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    header?.focus({ preventScroll: true });
    // A new press is a new `reveal`; a finished answer's cards do not change.
  }, [reveal, prefix, tools]);

  const names = sharedMeasureNames(tools);
  const highlighted = new Set(reveal?.callIds ?? []);
  const steps: StepTraceStep[] = tools.map((card) => {
    const line = stepLine(card, names);
    return {
      id: card.id,
      label: line,
      state: stepStateOf(card),
      detail: (
        <ToolCardView
          prefix={prefix}
          card={card}
          line={line}
          open={open.has(card.id)}
          onToggle={() =>
            setOpen((was) => {
              const next = new Set(was);
              if (next.has(card.id)) next.delete(card.id);
              else next.add(card.id);
              return next;
            })
          }
          highlighted={highlighted.has(card.id)}
          numbers={numbersByCall.get(card.id) ?? []}
          currentNumber={reveal?.number ?? null}
        />
      ),
    };
  });
  const checkStep: StepTraceStep[] =
    numberCheck === null
      ? []
      : numberCheck.review === null
        ? numberCheck.running
          ? [{ id: "number-check", label: NUMBER_CHECK_RUNNING, state: "current" }]
          : []
        : [
            {
              id: "number-check",
              label: reviewStepLabel(numberCheck.review),
              state: numberCheck.review.status === "failed" ? "failed" : "done",
              detail: <NumberCheckDetail review={numberCheck.review} />,
            },
          ];
  const withCheck = checkStep.length > 0;
  return (
    <StepTrace
      steps={[...steps, ...checkStep]}
      state={state}
      workingLabel={workingLabel}
      noun={withCheck ? "step" : "tool"}
      listLabel={withCheck ? "Tool calls and the number check" : "Tool calls"}
      {...(reveal === null ? {} : { revealKey: reveal.key })}
    />
  );
};
