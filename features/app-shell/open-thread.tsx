"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * The open thread's title, for the thread bar. A saved thread's page renders
 * `<ThreadTitle>`, which tells the shell its id and title while it is
 * mounted. The bar trusts the note only while the address is that thread's,
 * so a title never follows you to another page. Without the provider the
 * note is simply never set.
 */

export type OpenThread = Readonly<{ threadId: string; title: string }>;

type Note = Readonly<{
  open: OpenThread | null;
  setOpen: (update: (current: OpenThread | null) => OpenThread | null) => void;
}>;

const OpenThreadContext = createContext<Note>({ open: null, setOpen: () => undefined });

export const OpenThreadProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  const [open, setOpen] = useState<OpenThread | null>(null);
  const note = useMemo<Note>(() => ({ open, setOpen }), [open]);
  return <OpenThreadContext value={note}>{children}</OpenThreadContext>;
};

export const useOpenThread = (): OpenThread | null => useContext(OpenThreadContext).open;

/** Rendered by a saved thread's page; draws nothing. */
export const ThreadTitle = ({ threadId, title }: OpenThread) => {
  const { setOpen } = useContext(OpenThreadContext);
  useEffect(() => {
    setOpen(() => ({ threadId, title }));
    return () => setOpen((current) => (current?.threadId === threadId ? null : current));
  }, [setOpen, threadId, title]);
  return null;
};
