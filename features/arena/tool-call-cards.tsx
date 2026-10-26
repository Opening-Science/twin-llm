"use client";

import { useId, useState } from "react";

import { StatusBadge, type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import type { ToolActivity } from "./conversation";
import { rowsLabel, STATE_LABELS, type ToolCardState } from "./tool-cards";

/**
 * The answer's tool calls, one compact card each, folded by default. The
 * header names the call and its first arguments; the fold-out lists every
 * named argument, the tool's own name and, for a refusal, why. The same cards
 * show while the answer streams and after a reload (`tool-cards.ts`).
 */

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

const ToolCallCard = ({ card }: Readonly<{ card: ToolActivity }>) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const summary = card.args
    .slice(0, 2)
    .map((arg) => arg.value)
    .join(" · ");
  const rows = rowsLabel(card.rowCount);
  return (
    <li className="tool-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="tool-card-header"
      >
        <Chevron open={open} />
        <span className="text-foreground min-w-12 truncate font-medium">
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
      </div>
    </li>
  );
};

export const ToolCallCards = ({ cards }: Readonly<{ cards: readonly ToolActivity[] }>) =>
  cards.length === 0 ? null : (
    <ul aria-label="Tool calls" className="flex flex-col gap-1.5">
      {cards.map((card) => (
        <ToolCallCard key={card.id} card={card} />
      ))}
    </ul>
  );
