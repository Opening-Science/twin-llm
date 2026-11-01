import { NEW_CHAT_HREF } from "@/infrastructure/incognito";

/**
 * Which conversation the new-chat page at `/` shows (#377).
 *
 * The first send on `/` moves the address to `/t/<id>` with `replaceState`
 * and does not navigate, so the open streams survive. Next.js still holds the
 * home page's tree there. A later link to `/` (the sidebar's New, the
 * TwinLLM section, the logo, the search palette's New chat) lands on that
 * same page, and React would keep the old conversation and its thread id.
 *
 * Every arrival at `/` from another path therefore starts a new generation,
 * and the screen is keyed on it: a completed turn, a turn still streaming and
 * an empty screen all give way to an empty conversation with no thread id.
 * Answers already streaming carry on in the background and are saved as
 * usual; reopening the thread shows them.
 */
export type ConversationGeneration = Readonly<{ pathname: string; generation: number }>;

export const firstGeneration = (pathname: string): ConversationGeneration => ({
  pathname,
  generation: 0,
});

/** The generation once the address reads `pathname`; the same object when nothing changed. */
export const generationAt = (
  current: ConversationGeneration,
  pathname: string,
): ConversationGeneration => {
  if (pathname === current.pathname) return current;
  const arrivedHome = pathname === NEW_CHAT_HREF;
  return {
    pathname,
    generation: arrivedHome ? current.generation + 1 : current.generation,
  };
};
