import type { ChatView } from "@/infrastructure/chat-view";

import type { TurnState } from "./conversation";

/**
 * What the Outputs panel lists: every view the thread's answers show, newest
 * first, each once (a view reopened with `open_view` counts at its newest
 * showing). Built from the same answer state the columns draw, so a reloaded
 * thread lists exactly the charts it shows. Pure; the panel and its storage
 * live in `outputs-panel.tsx`.
 */

export type OutputEntry = Readonly<{
  /** Unique per answer and view: React key and the panel's large-view choice. */
  key: string;
  /** The element id of the chart in its answer, to scroll to. */
  anchorId: string;
  view: ChatView;
  modelName: string;
  /** When its answer finished; null while it still streams. */
  at: string | null;
}>;

export const viewAnchorId = (answerId: string, viewId: string): string =>
  `output-${answerId}-${viewId}`;

const KIND_LABELS: Readonly<Record<ChatView["kind"], string>> = {
  "chart.timeseries": "Time series",
};

export const viewKindLabel = (kind: ChatView["kind"]): string => KIND_LABELS[kind];

/** Later first; an answer still streaming (no time yet) is the newest. */
const newestFirst = (a: OutputEntry, b: OutputEntry): number =>
  (b.at ?? "￿").localeCompare(a.at ?? "￿");

export const threadOutputs = (turns: readonly TurnState[]): OutputEntry[] => {
  const all = [...turns].reverse().flatMap((turn) =>
    turn.answers
      .flatMap((answer) =>
        [...(answer.views ?? [])].reverse().map((view) => ({
          key: `${answer.id}:${view.id}`,
          anchorId: viewAnchorId(answer.id, view.id),
          view,
          modelName: answer.modelName,
          at: answer.completedAt ?? null,
        })),
      )
      .sort(newestFirst),
  );
  return all.filter(
    (entry, index) => all.findIndex((other) => other.view.id === entry.view.id) === index,
  );
};

/** How the panel is shown, remembered per viewer. */
export type PanelState = "open" | "collapsed" | "closed";

export const PANEL_KEY = "twinllm.outputs-panel";

export type PanelStorage = Pick<Storage, "getItem" | "setItem">;

const PANEL_STATES: readonly PanelState[] = ["open", "collapsed", "closed"];

/** Storage can be missing or throw (private mode, blocked site data); then it opens. */
export const readPanelState = (storage: PanelStorage | null): PanelState => {
  try {
    const saved = storage?.getItem(PANEL_KEY) ?? null;
    return PANEL_STATES.find((state) => state === saved) ?? "open";
  } catch {
    return "open";
  }
};

export const savePanelState = (storage: PanelStorage | null, state: PanelState): void => {
  try {
    storage?.setItem(PANEL_KEY, state);
  } catch {
    // Not remembered; the next visit opens it again.
  }
};

/** `window.localStorage` itself throws when site data is blocked. */
export const panelStorage = (): PanelStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
