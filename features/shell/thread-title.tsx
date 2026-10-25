"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * The open thread's title, for the top bar.
 *
 * The bar lives in the shell layout, above the page, so the page cannot hand
 * it a prop. Instead the thread page renders `<ThreadTitle>`, which says what
 * it is showing, and the bar reads that back. The note is keyed by thread id
 * and only counts while the path is that thread's, so a title can never follow
 * you onto another page during a navigation.
 *
 * A missing provider degrades to a no-op, like `thread-history-store.tsx`: a
 * breadcrumb that says "Thread" is not worth crashing a page over.
 */
export type PublishedTitle = Readonly<{ threadId: string; title: string }> | null;

type Store = Readonly<{
  published: PublishedTitle;
  setPublished: Dispatch<SetStateAction<PublishedTitle>>;
}>;

const NO_OP_STORE: Store = Object.freeze({ published: null, setPublished: () => {} });

const ThreadTitleContext = createContext<Store>(NO_OP_STORE);

export const ThreadTitleProvider = ({ children }: { readonly children: ReactNode }) => {
  const [published, setPublished] = useState<PublishedTitle>(null);
  const value = useMemo(() => ({ published, setPublished }), [published]);

  return (
    <ThreadTitleContext.Provider value={value}>{children}</ThreadTitleContext.Provider>
  );
};

/** The title for this path, or nothing when the note is about another thread. */
export const titleFor = (
  published: PublishedTitle,
  pathname: string,
): string | undefined =>
  published !== null && pathname === `/t/${published.threadId}`
    ? published.title
    : undefined;

export const useThreadTitle = (pathname: string): string | undefined =>
  titleFor(useContext(ThreadTitleContext).published, pathname);

/** Renders nothing; tells the top bar which thread is open and what it is called. */
export const ThreadTitle = ({
  threadId,
  title,
}: {
  readonly threadId: string;
  readonly title: string;
}) => {
  const { setPublished } = useContext(ThreadTitleContext);

  useEffect(() => {
    setPublished({ threadId, title });
    return () =>
      setPublished((current) => (current?.threadId === threadId ? null : current));
  }, [setPublished, threadId, title]);

  return null;
};
