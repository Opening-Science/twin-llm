"use client";

import { useEffect, useId, useState } from "react";

import type { ChatView } from "@/infrastructure/chat-view";
import { formatRelative } from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";

import { ViewFigure } from "./answer-views";
import { Mark } from "./marks";
import {
  isEmptyView,
  NO_READINGS_SHORT,
  type OutputEntry,
  type PanelState,
  panelStorage,
  readPanelState,
  savePanelState,
  viewKindLabel,
} from "./thread-outputs";

/**
 * The thread's Outputs: every chart its answers showed, newest first. A row
 * scrolls to the chart in its answer; "Enlarge" draws it large here. The
 * panel can be collapsed to its header or closed to one button, and each
 * viewer's choice is remembered in this browser.
 */

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const scrollToView = (anchorId: string): void => {
  const target = document.getElementById(anchorId);
  if (target === null) return;
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
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
    className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
  >
    <path d="m5 8 5 5 5-5" />
  </svg>
);

/** A view with no points is listed dimmed and says so; it stays reachable. */
const EntryRow = ({
  entry,
  onEnlarge,
}: Readonly<{ entry: OutputEntry; onEnlarge: () => void }>) => (
  <li className="output-entry" data-empty={isEmptyView(entry.view) || undefined}>
    <button
      type="button"
      className="output-entry-main"
      onClick={() => scrollToView(entry.anchorId)}
    >
      {/* Dimmed with the muted text colour, not opacity, so it keeps its contrast. */}
      <span
        className={`line-clamp-2 ${isEmptyView(entry.view) ? "text-muted-foreground" : "text-foreground font-medium"}`}
      >
        {entry.view.title}
      </span>
      <span className="text-muted-foreground">
        {isEmptyView(entry.view) ? `${NO_READINGS_SHORT} · ` : ""}
        {viewKindLabel(entry.view.kind)} · {entry.modelName} ·{" "}
        <time dateTime={entry.at ?? undefined} suppressHydrationWarning>
          {entry.at === null ? "now" : formatRelative(entry.at)}
        </time>
      </span>
    </button>
    <Button
      size="sm"
      variant="ghost"
      onClick={onEnlarge}
      aria-label={`Enlarge ${entry.view.title}`}
    >
      Enlarge
    </Button>
  </li>
);

export const OutputsPanel = ({
  entries,
  onLargeChange,
  onShownChange,
}: Readonly<{
  entries: readonly OutputEntry[];
  /** Tells the layout to widen the panel while a view is drawn large. */
  onLargeChange?: (large: boolean) => void;
  /** Whether the panel is open and which view it draws large, for the UI context. */
  onShownChange?: (shown: Readonly<{ open: boolean; large: ChatView | null }>) => void;
}>) => {
  const [state, setState] = useState<PanelState>("open");
  const [largeKey, setLargeKey] = useState<string | null>(null);
  const headingId = useId();
  const bodyId = useId();

  // Storage is read after mount, so the server render and the first client
  // render agree; a remembered choice applies a frame later.
  useEffect(() => {
    setState(readPanelState(panelStorage()));
  }, []);

  const large = entries.find((entry) => entry.key === largeKey) ?? null;
  const showLarge = state === "open" && large !== null;

  useEffect(() => {
    onLargeChange?.(showLarge);
  }, [showLarge, onLargeChange]);

  const largeView = showLarge ? large.view : null;
  const open = state === "open";
  useEffect(() => {
    onShownChange?.({ open, large: largeView });
  }, [open, largeView, onShownChange]);

  if (entries.length === 0) return null;

  const choose = (next: PanelState) => {
    setState(next);
    savePanelState(panelStorage(), next);
  };

  if (state === "closed") {
    return (
      <div className="outputs-reopen">
        <Button size="sm" onClick={() => choose("open")}>
          Outputs · {entries.length}
        </Button>
      </div>
    );
  }

  return (
    <aside aria-labelledby={headingId} className="outputs-panel">
      <header className="flex items-center gap-1">
        <h2 id={headingId} className="text-sm font-medium">
          <button
            type="button"
            aria-expanded={state === "open"}
            aria-controls={bodyId}
            onClick={() => choose(state === "open" ? "collapsed" : "open")}
            className="hover:bg-muted flex items-center gap-1.5 rounded-md px-1.5 py-1"
          >
            <Chevron open={state === "open"} />
            Outputs
            <span className="text-muted-foreground font-normal tabular-nums">
              {entries.length}
            </span>
          </button>
        </h2>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => choose("closed")}
          aria-label="Close the Outputs panel"
        >
          <Mark name="remove" className="size-3.5" />
        </Button>
      </header>
      <div id={bodyId} hidden={state !== "open"} className="min-h-0 overflow-y-auto">
        {showLarge ? (
          <div className="flex flex-col items-start gap-2">
            <Button size="sm" variant="ghost" onClick={() => setLargeKey(null)}>
              ← All outputs
            </Button>
            <div className="w-full">
              <ViewFigure view={large.view} height={280} />
            </div>
            <p className="text-muted-foreground text-xs">
              {large.modelName} ·{" "}
              <Button
                size="sm"
                variant="ghost"
                className="px-0 underline underline-offset-2"
                onClick={() => scrollToView(large.anchorId)}
              >
                Show in the answer
              </Button>
            </p>
          </div>
        ) : (
          <ol aria-label="Views in this thread, newest first" className="flex flex-col">
            {entries.map((entry) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                onEnlarge={() => setLargeKey(entry.key)}
              />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
};
