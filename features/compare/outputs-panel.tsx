"use client";

import { useCallback, useId, useSyncExternalStore } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { ChevronIcon, CrossIcon } from "@/infrastructure/ui-kit/icons";
import { useReducedMotion } from "@/infrastructure/ui-kit/use-reduced-motion";
import { cn } from "@/infrastructure/ui";
import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

import { ViewFigure } from "./answer-views";
import {
  entryDetail,
  type OutputEntry,
  type OutputsMode,
  readOutputsMode,
  reopenLabel,
  saveOutputsMode,
} from "./outputs-panel-model";
import { viewAnchorId } from "./view-text";

export type { OutputEntry, OutputsMode } from "./outputs-panel-model";
export { outputEntriesOf } from "./outputs-panel-model";

/**
 * The thread's Outputs panel (SPEC 3.1, 11): every view the answers drew,
 * newest first. A row scrolls to its figure in the answer and focuses it;
 * Enlarge draws the view large in the panel. Open, collapsed or closed is
 * this browser's choice, kept in local storage and read after first paint.
 */

const browserStorage = (): Storage | null =>
  typeof window === "undefined" ? null : window.localStorage;

const MODE_EVENT = "twinllm:outputs-mode";

const subscribeMode = (listener: () => void) => {
  window.addEventListener(MODE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(MODE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
};

/**
 * The panel's mode: open on the server and while hydrating, then the stored
 * choice. Choosing writes it and tells every panel on the page.
 */
export const useOutputsMode = (): readonly [OutputsMode, (mode: OutputsMode) => void] => {
  const mode = useSyncExternalStore(
    subscribeMode,
    () => readOutputsMode(browserStorage),
    () => "open" as const,
  );
  const choose = useCallback((next: OutputsMode) => {
    saveOutputsMode(browserStorage, next);
    window.dispatchEvent(new Event(MODE_EVENT));
  }, []);
  return [mode, choose] as const;
};

/** Scrolls a figure into the middle of the view and focuses it. */
const showFigure = (entry: OutputEntry, reducedMotion: boolean): void => {
  const figure = document.getElementById(viewAnchorId(entry.answerId, entry.view.id));
  if (figure === null) return;
  figure.scrollIntoView({
    block: "center",
    behavior: reducedMotion ? "instant" : "smooth",
  });
  figure.focus({ preventScroll: true });
};

type PanelProps = Readonly<{
  entries: readonly OutputEntry[];
  mode: OutputsMode;
  onMode: (mode: OutputsMode) => void;
  enlargedId: string | null;
  onEnlarge: (viewId: string | null) => void;
  onOrganPick?: (organ: TwinFocusId) => void;
}>;

export const OutputsPanel = ({
  entries,
  mode,
  onMode,
  enlargedId,
  onEnlarge,
  onOrganPick,
}: PanelProps) => {
  const headingId = useId();
  const bodyId = useId();
  const reducedMotion = useReducedMotion();
  if (entries.length === 0) return null;

  if (mode === "closed") {
    return (
      <div className="compare-outputs-reopen">
        <Button size="sm" variant="pill" onClick={() => onMode("open")}>
          {reopenLabel(entries.length)}
        </Button>
      </div>
    );
  }

  const open = mode === "open";
  const enlarged =
    enlargedId === null
      ? null
      : (entries.find((entry) => entry.view.id === enlargedId) ?? null);

  return (
    <aside aria-labelledby={headingId} className="compare-outputs-panel">
      <div className="flex items-center gap-1">
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => onMode(open ? "collapsed" : "open")}
            className="hover:bg-muted flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-medium"
          >
            <ChevronIcon
              aria-hidden="true"
              className={cn("transition-transform", open && "rotate-90")}
            />
            Outputs
            <span className="text-muted-foreground font-mono text-xs">
              {String(entries.length)}
            </span>
          </button>
        </h2>
        <button
          type="button"
          aria-label="Close the Outputs panel"
          onClick={() => onMode("closed")}
          className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1.5"
        >
          <CrossIcon aria-hidden="true" />
        </button>
      </div>
      <div id={bodyId} hidden={!open} className="min-h-0 overflow-y-auto">
        {enlarged === null ? (
          <ul aria-label="This thread's views, newest first" className="flex flex-col">
            {entries.map((entry) => (
              <li key={entry.view.id} className="compare-output-entry">
                <button
                  type="button"
                  className="compare-output-entry-main"
                  onClick={() => showFigure(entry, reducedMotion)}
                >
                  <span className="font-medium">{entry.view.title}</span>
                  <span className="text-muted-foreground">{entryDetail(entry)}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Enlarge ${entry.view.title}`}
                  onClick={() => onEnlarge(entry.view.id)}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded-md px-1.5 py-1 text-xs"
                >
                  Enlarge
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2 p-1">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => onEnlarge(null)}>
                ← All outputs
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => showFigure(enlarged, reducedMotion)}
              >
                Show in the answer
              </Button>
            </div>
            <ViewFigure view={enlarged.view} onOrganPick={onOrganPick} />
          </div>
        )}
      </div>
    </aside>
  );
};
