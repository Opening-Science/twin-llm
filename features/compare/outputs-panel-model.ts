import type { ChatView } from "@/infrastructure/chat-view";

import type { TurnState } from "./conversation";

/**
 * The thread's Outputs panel, without React (SPEC 3.1, 11): which views it
 * lists, and the open, collapsed or closed choice this browser keeps.
 */

export type OutputsMode = "open" | "collapsed" | "closed";

export const OUTPUTS_MODES: readonly OutputsMode[] = ["open", "collapsed", "closed"];

export const OUTPUTS_STORAGE_KEY = "twinllm.outputs-panel";

export type OutputEntry = Readonly<{
  answerId: string;
  modelName: string;
  view: ChatView;
}>;

/** Every view of the thread, newest first, once per view id (its first drawing wins). */
export const outputEntriesOf = (turns: readonly TurnState[]): OutputEntry[] => {
  const inOrder = turns.flatMap((turn) =>
    turn.answers.flatMap((answer) =>
      (answer.views ?? []).map((view) => ({
        answerId: answer.id,
        modelName: answer.modelName,
        view,
      })),
    ),
  );
  const seen = new Set<string>();
  const once = inOrder.filter((entry) => {
    if (seen.has(entry.view.id)) return false;
    seen.add(entry.view.id);
    return true;
  });
  return once.reverse();
};

const isMode = (value: unknown): value is OutputsMode =>
  typeof value === "string" && (OUTPUTS_MODES as readonly string[]).includes(value);

type ModeStorage = Pick<Storage, "getItem" | "setItem">;

/** The stored choice; missing, unknown or throwing storage means open. */
export const readOutputsMode = (storage: () => ModeStorage | null): OutputsMode => {
  try {
    const value = storage()?.getItem(OUTPUTS_STORAGE_KEY) ?? null;
    return isMode(value) ? value : "open";
  } catch {
    return "open";
  }
};

/** Keeps the choice; a storage that throws keeps nothing and says nothing. */
export const saveOutputsMode = (
  storage: () => ModeStorage | null,
  mode: OutputsMode,
): void => {
  try {
    storage()?.setItem(OUTPUTS_STORAGE_KEY, mode);
  } catch {
    // Private windows and blocked storage: the choice lasts this page only.
  }
};

/** "Outputs · 3", the one button a closed panel leaves. */
export const reopenLabel = (count: number): string => `Outputs · ${String(count)}`;

/** The row's second line: the answer that drew it. */
export const entryDetail = (entry: OutputEntry): string => `From ${entry.modelName}`;
