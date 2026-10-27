import { type Command, TWIN_COMMAND } from "@/features/commands/registry";

/**
 * Where the prompt bar sends what was typed or picked. `/twin` is a view,
 * not a question: it opens the twin card and never reaches `send`, so it
 * never starts a turn, never calls `/api/chat` and never enters a model's
 * history.
 */

export type PromptHandlers = Readonly<{
  /** Starts a turn: the prompt goes to the chosen models. */
  send: () => void;
  /** Shows the twin card in this conversation; asks no model. */
  openTwin: () => void;
}>;

const TWIN_DRAFT = new RegExp(`^/${TWIN_COMMAND}$`, "i");

export const isTwinDraft = (draft: string): boolean => TWIN_DRAFT.test(draft.trim());

/** Enter or the send button: `/twin` on its own opens the card; anything else is sent. */
export const routeDraft = (draft: string, handlers: PromptHandlers): "twin" | "send" => {
  if (isTwinDraft(draft)) {
    handlers.openTwin();
    return "twin";
  }
  handlers.send();
  return "send";
};

/** A palette pick: `/twin` opens the card at once; other commands are the bar's to handle. */
export const routePick = (
  command: Command | null,
  handlers: Pick<PromptHandlers, "openTwin">,
): boolean => {
  if (command?.kind !== "skill" && command?.name === TWIN_COMMAND) {
    handlers.openTwin();
    return true;
  }
  return false;
};
