import {
  COMPACT_COMMAND,
  type Command,
  TWIN_COMMAND,
} from "@/features/commands/registry";

/**
 * Where the prompt bar sends what was typed or picked. `/twin` is a view,
 * not a question: it opens the twin card and never reaches `send`, so it
 * never starts a turn, never calls `/api/chat` and never enters a model's
 * history. `/compact` (#43) is the same kind of command: it asks for a draft
 * twin note of the thread and starts no turn.
 */

export type PromptHandlers = Readonly<{
  /** Starts a turn: the prompt goes to the chosen models. */
  send: () => void;
  /** Shows the twin card in this conversation; asks no model. */
  openTwin: () => void;
  /** Drafts a twin note of this thread; starts no turn. */
  openCompact: () => void;
}>;

const TWIN_DRAFT = new RegExp(`^/${TWIN_COMMAND}$`, "i");
const COMPACT_DRAFT = new RegExp(`^/${COMPACT_COMMAND}$`, "i");

export const isTwinDraft = (draft: string): boolean => TWIN_DRAFT.test(draft.trim());

export const isCompactDraft = (draft: string): boolean =>
  COMPACT_DRAFT.test(draft.trim());

/** Enter or the send button: `/twin` or `/compact` on its own opens its card; anything else is sent. */
export const routeDraft = (
  draft: string,
  handlers: PromptHandlers,
): "twin" | "compact" | "send" => {
  if (isTwinDraft(draft)) {
    handlers.openTwin();
    return "twin";
  }
  if (isCompactDraft(draft)) {
    handlers.openCompact();
    return "compact";
  }
  handlers.send();
  return "send";
};

/** A palette pick: `/twin` and `/compact` act at once; other commands are the bar's to handle. */
export const routePick = (
  command: Command | null,
  handlers: Pick<PromptHandlers, "openTwin" | "openCompact">,
): boolean => {
  if (command === null || command.kind === "skill") return false;
  if (command.name === TWIN_COMMAND) {
    handlers.openTwin();
    return true;
  }
  if (command.name === COMPACT_COMMAND) {
    handlers.openCompact();
    return true;
  }
  return false;
};
