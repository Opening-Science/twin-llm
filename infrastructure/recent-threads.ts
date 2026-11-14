import type { TouchedThread } from "./thread-history-store";

/**
 * The viewer's threads as the sidebar and the search box's recents list them:
 * the server's list with what this tab has just done laid over it. Pure, so
 * both read one rule.
 *
 * - Threads this tab has just sent prompts to lead, newest first. Where the
 *   server already lists one, its row (title and model count across every
 *   turn) is used; the tab's note only fills in a thread the server has not
 *   drawn yet.
 * - Threads whose delete is pending or done are left out.
 */

/** One of the viewer's threads, as the server lists it. */
export type ShellThread = Readonly<{
  id: string;
  title: string;
  /** Last activity, ISO 8601. */
  updatedAt: string;
  /** Distinct models that answered anywhere in the thread. */
  modelCount: number;
}>;

export type RecentThread = Readonly<{
  id: string;
  title: string;
  /** Null for a thread only this tab knows about yet. */
  updatedAt: string | null;
  modelCount: number;
  /** This tab has just sent a prompt to it. */
  touched: boolean;
}>;

export const mergeRecentThreads = (
  server: readonly ShellThread[],
  touched: readonly TouchedThread[],
  hidden: ReadonlySet<string>,
): readonly RecentThread[] => {
  const byId = new Map(server.map((thread) => [thread.id, thread]));
  const touchedIds = new Set(touched.map(({ id }) => id));
  const lead = touched
    .filter(({ id }) => !hidden.has(id))
    .map((note): RecentThread => {
      const listed = byId.get(note.id);
      return listed === undefined
        ? { ...note, updatedAt: null, touched: true }
        : { ...listed, touched: true };
    });
  const rest = server
    .filter(({ id }) => !touchedIds.has(id) && !hidden.has(id))
    .map((thread): RecentThread => ({ ...thread, touched: false }));
  return [...lead, ...rest];
};

/** How many recent threads the search box lists before anything is typed. */
export const RECENTS_LIMIT = 8;
