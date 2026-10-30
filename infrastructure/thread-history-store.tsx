"use client";

import { createContext, type ReactNode, useContext, useMemo, useReducer } from "react";

/**
 * Threads this browser has sent prompts to since the page was rendered, so the
 * sidebar can list a new thread before the next server render knows about it.
 *
 * `features/arena` records a thread when its prompt is accepted and
 * `features/shell` reads the list; features cannot import each other, so the
 * store sits in `infrastructure/`. It is a short-lived note, not a cache: the
 * server's thread list stays the source of truth, and the sidebar prefers it
 * wherever both know a thread (`mergeTouchedThreads`).
 *
 * It also holds the threads being deleted (`hidden`): the thread bar's Delete
 * takes a thread out of the sidebar at once and puts it back on Undo, while
 * the server delete waits for the undo window to end.
 *
 * Without a provider the hook returns an empty, inert store, so a screen that
 * forgets the provider loses the sidebar shortcut instead of crashing.
 */
export type TouchedThread = Readonly<{
  id: string;
  title: string;
  /** Models just sent to; only shown for a thread the server list lacks. */
  modelCount: number;
}>;

type ThreadHistory = Readonly<{
  touched: readonly TouchedThread[];
  noteThreadTouched: (thread: TouchedThread) => void;
  /** Thread ids the sidebar leaves out while their delete is pending or done. */
  hidden: ReadonlySet<string>;
  setThreadHidden: (id: string, hidden: boolean) => void;
}>;

const INERT: ThreadHistory = Object.freeze({
  touched: Object.freeze<TouchedThread[]>([]),
  noteThreadTouched: () => undefined,
  hidden: new Set<string>(),
  setThreadHidden: () => undefined,
});

const HistoryContext = createContext<ThreadHistory>(INERT);

/** Newest first, one entry per thread id. */
export const withTouchedThread = (
  list: readonly TouchedThread[],
  latest: TouchedThread,
): readonly TouchedThread[] => [latest, ...list.filter(({ id }) => id !== latest.id)];

/** The set with `id` added or taken out; the same set when nothing changes. */
export const withThreadHidden = (
  set: ReadonlySet<string>,
  change: Readonly<{ id: string; hidden: boolean }>,
): ReadonlySet<string> => {
  if (set.has(change.id) === change.hidden) return set;
  const next = new Set(set);
  if (change.hidden) next.add(change.id);
  else next.delete(change.id);
  return next;
};

export const ThreadHistoryProvider = ({ children }: { readonly children: ReactNode }) => {
  const [touched, noteThreadTouched] = useReducer(withTouchedThread, []);
  const [hidden, changeHidden] = useReducer(
    withThreadHidden,
    new Set<string>() as ReadonlySet<string>,
  );
  const history = useMemo<ThreadHistory>(
    () => ({
      touched,
      noteThreadTouched,
      hidden,
      setThreadHidden: (id: string, on: boolean) => changeHidden({ id, hidden: on }),
    }),
    [touched, hidden],
  );
  return <HistoryContext value={history}>{children}</HistoryContext>;
};

export const useThreadHistory = (): ThreadHistory => useContext(HistoryContext);
