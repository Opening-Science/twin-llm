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
}>;

const INERT: ThreadHistory = Object.freeze({
  touched: Object.freeze<TouchedThread[]>([]),
  noteThreadTouched: () => undefined,
});

const HistoryContext = createContext<ThreadHistory>(INERT);

/** Newest first, one entry per thread id. */
export const withTouchedThread = (
  list: readonly TouchedThread[],
  latest: TouchedThread,
): readonly TouchedThread[] => [latest, ...list.filter(({ id }) => id !== latest.id)];

export const ThreadHistoryProvider = ({ children }: { readonly children: ReactNode }) => {
  const [touched, noteThreadTouched] = useReducer(withTouchedThread, []);
  const history = useMemo<ThreadHistory>(
    () => ({ touched, noteThreadTouched }),
    [touched],
  );
  return <HistoryContext value={history}>{children}</HistoryContext>;
};

export const useThreadHistory = (): ThreadHistory => useContext(HistoryContext);
