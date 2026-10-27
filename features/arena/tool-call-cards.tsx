"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { NumberSource } from "@/infrastructure/number-sources";
import { StatusBadge, type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import type { ToolActivity } from "./conversation";
import { cardNumbers, sourceCallIds } from "./number-links";
import { rowsLabel, STATE_LABELS, type ToolCardState } from "./tool-cards";

/**
 * The answer's tool calls, one compact card each, folded by default. The
 * header names the call and its first arguments; the fold-out lists every
 * named argument, the tool's own name, for a refusal why, and the answer's
 * numbers the call holds with their rows. The same cards show while the
 * answer streams and after a reload (`tool-cards.ts`).
 *
 * A number pressed in the answer (`ActiveNumber`) opens every card that holds
 * it and moves focus to the first; `key` changes on each press, so pressing
 * the same number again scrolls back to it.
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

const Chevron = ({ open }: Readonly<{ open: boolean }>) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
  >
    <path d="m8 5 5 5-5 5" />
  </svg>
);

type CardProps = Readonly<{
  card: ToolActivity;
  numbers: readonly NumberSource[];
  titleId: string | undefined;
  /** The pressed number when this card holds it. */
  highlight: ActiveNumber | null;
  /** This is the first card that holds it: it takes focus. */
  focus: boolean;
}>;

const ToolCallCard = ({ card, numbers, titleId, highlight, focus }: CardProps) => {
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

  const summary = card.args
    .slice(0, 2)
    .map((arg) => arg.value)
    .join(" · ");
  const rows = rowsLabel(card.rowCount);
  const held = cardNumbers(numbers, card.id);
  return (
    <li className="tool-card" data-highlight={highlight === null ? undefined : ""}>
      <button
        ref={header}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="tool-card-header"
      >
        <Chevron open={open} />
        <span id={titleId} className="text-foreground min-w-12 truncate font-medium">
          {card.title}
        </span>
        {/* Zero basis: the summary only takes the room the title leaves. */}
        <span className="text-muted-foreground min-w-0 flex-1 basis-0 truncate">
          {summary}
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
    </li>
  );
};

export const ToolCallCards = ({
  cards,
  numbers = [],
  active = null,
  idPrefix,
}: Readonly<{
  cards: readonly ToolActivity[];
  /** The answer's numbers and the calls that hold them. */
  numbers?: readonly NumberSource[];
  active?: ActiveNumber | null;
  /** Gives each card title an id the answer's numbers point to. */
  idPrefix?: string;
}>) => {
  if (cards.length === 0) return null;
  const holders =
    active === null
      ? []
      : sourceCallIds(numbers.filter((source) => source.text === active.text));
  return (
    <ul aria-label="Tool calls" className="flex flex-col gap-1.5">
      {cards.map((card) => (
        <ToolCallCard
          key={card.id}
          card={card}
          numbers={numbers}
          titleId={
            idPrefix === undefined ? undefined : toolCardTitleId(idPrefix, card.id)
          }
          highlight={holders.includes(card.id) ? active : null}
          focus={holders[0] === card.id}
        />
      ))}
    </ul>
  );
};
