"use client";

import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { mergeRecentThreads, type ShellThread } from "@/infrastructure/recent-threads";
import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { cn } from "@/infrastructure/ui";
import { CrossIcon } from "@/infrastructure/ui-kit/icons";
import {
  BookIcon,
  ChatIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  SlashIcon,
} from "@/infrastructure/ui-kit/nav-icons";

import { SearchOpener, useOpenSearch } from "./search-context";
import type { StaticSearchItems } from "./search-items";
import {
  nextTab,
  SEARCH_TABS,
  type SearchItem,
  type SearchItemKind,
  type SearchTab,
  TAB_LABELS,
} from "./search-model";
import {
  NOTHING_MATCHES,
  readServerAnswer,
  resultGroups,
  SEARCH_PRIVACY,
  type ServerAnswer,
  wantsServer,
  WORDS_ONLY,
} from "./search-results";

/**
 * The search box (#167): Ctrl/⌘+K or the sidebar's Search row opens a
 * centred modal over the shell. Before anything is typed it lists recent
 * threads and two actions; a typed query adds the viewer's threads and the
 * docs from the server, and pages and commands matched here. Wraps the shell
 * so any part of it can open the box through `useOpenSearch`.
 */

const DEBOUNCE_MS = 180;

const KIND_ICON: Readonly<
  Record<SearchItemKind, (props: { className?: string }) => ReactNode>
> = {
  thread: ChatIcon,
  page: PageIcon,
  doc: BookIcon,
  command: SlashIcon,
  action: PlusIcon,
};

type Answer = Readonly<{
  key: string;
  result: ServerAnswer | Readonly<{ error: string }>;
}>;

const answerKey = (query: string, tab: SearchTab): string =>
  `${tab}\u0000${query.trim()}`;

export const SearchBox = ({
  threads,
  statics,
  children,
}: Readonly<{
  threads: readonly ShellThread[];
  statics: StaticSearchItems;
  children: ReactNode;
}>) => {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <SearchOpener open={show}>
      {children}
      {open && (
        <SearchDialog
          threads={threads}
          statics={statics}
          onClose={() => setOpen(false)}
        />
      )}
    </SearchOpener>
  );
};

/** The sidebar's Search row. `data-closes-panel` lets the phone menu close first. */
export const SearchRow = () => {
  const openSearch = useOpenSearch();
  return (
    <button type="button" className="nav-link" data-closes-panel="" onClick={openSearch}>
      <SearchIcon />
      Search
      <kbd className="search-kbd ml-auto">Ctrl K</kbd>
    </button>
  );
};

const SearchDialog = ({
  threads,
  statics,
  onClose,
}: Readonly<{
  threads: readonly ShellThread[];
  statics: StaticSearchItems;
  onClose: () => void;
}>) => {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ids = useId();
  const listId = `${ids}-results`;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const { touched, hidden } = useThreadHistory();

  // Mounted only while open: show it, focus the field, and ask the server to
  // embed what is new. That request's failure changes nothing here.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (!element.open) element.showModal();
    input.current?.focus();
    void fetch("/api/search", { method: "POST", credentials: "same-origin" }).catch(
      () => undefined,
    );
    // A click on the backdrop lands on the dialog itself; its content covers the rest.
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === element) element.close();
    };
    element.addEventListener("click", onBackdrop);
    return () => element.removeEventListener("click", onBackdrop);
  }, []);

  useEffect(() => {
    if (!wantsServer(query, tab)) return;
    const key = answerKey(query, tab);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), tab });
      fetch(`/api/search?${params.toString()}`, {
        credentials: "same-origin",
        signal: abort.signal,
      })
        .then(async (response) =>
          setAnswer({
            key,
            result: readServerAnswer(
              response.ok,
              await response.json().catch(() => null),
            ),
          }),
        )
        .catch(() => {
          if (!abort.signal.aborted)
            setAnswer({ key, result: readServerAnswer(false, null) });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, tab]);

  const asking = wantsServer(query, tab);
  const current = asking && answer?.key === answerKey(query, tab) ? answer.result : null;
  const loading = asking && current === null;
  const server = current !== null && "threads" in current ? current : null;
  const error = current !== null && "error" in current ? current.error : null;

  const recents = useMemo(
    () => mergeRecentThreads(threads, touched, hidden),
    [threads, touched, hidden],
  );
  const groups = resultGroups({ query, tab, recents, statics, server });
  const options = groups.flatMap((group) => group.items);
  const activeIndex = options.length === 0 ? -1 : Math.min(active, options.length - 1);
  const optionId = (index: number) => `${ids}-option-${index}`;

  const close = () => dialog.current?.close();

  const go = (item: SearchItem | undefined) => {
    if (item?.href === undefined) return;
    close();
    router.push(item.href);
  };

  const changeQuery = (next: string) => {
    setQuery(next);
    setActive(0);
  };
  const changeTab = (next: SearchTab) => {
    setTab(next);
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    const count = options.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (count > 0) setActive((activeIndex + 1) % count);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (count > 0) setActive((activeIndex - 1 + count) % count);
        return;
      case "Enter":
        event.preventDefault();
        go(options[activeIndex]);
        return;
      case "ArrowRight":
        if (
          field.selectionStart === field.value.length &&
          field.selectionEnd === field.value.length
        ) {
          event.preventDefault();
          changeTab(nextTab(tab, 1));
        }
        return;
      case "ArrowLeft":
        if (field.selectionStart === 0 && field.selectionEnd === 0) {
          event.preventDefault();
          changeTab(nextTab(tab, -1));
        }
        return;
    }
  };

  // Indexes run across the groups, in the order they are drawn.
  const startOf = groups.reduce<readonly number[]>(
    (starts, group, index) => [
      ...starts,
      index === 0 ? 0 : (starts[index - 1] ?? 0) + (groups[index - 1]?.items.length ?? 0),
    ],
    [],
  );

  return (
    <dialog ref={dialog} aria-label="Search" className="search-dialog" onClose={onClose}>
      <div className="border-border border-b px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <SearchIcon className="text-muted-foreground" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={activeIndex < 0 ? undefined : optionId(activeIndex)}
            aria-label="Search"
            placeholder="Search threads, pages, docs and commands"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            aria-label="Close search"
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
            onClick={close}
          >
            <CrossIcon className="size-4" />
          </button>
        </div>

        <div role="tablist" aria-label="Result types" className="mt-3 -ml-1 flex gap-1">
          {SEARCH_TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className="search-tab"
              onClick={() => {
                changeTab(value);
                input.current?.focus();
              }}
            >
              {TAB_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Results"
        aria-busy={loading}
        className="max-h-[min(60vh,28rem)] overflow-y-auto px-2 pt-3 pb-2"
      >
        {groups.map((group, groupIndex) => {
          const titleId = `${ids}-group-${groupIndex}`;
          return (
            <div
              key={group.title}
              role="group"
              aria-labelledby={titleId}
              className="mb-1"
            >
              <div id={titleId} className="text-muted-foreground px-3 pt-2 pb-1 text-xs">
                {group.title}
              </div>
              {group.items.map((item, itemIndex) => {
                const index = (startOf[groupIndex] ?? 0) + itemIndex;
                const Icon = KIND_ICON[item.kind];
                return (
                  <div
                    key={`${item.kind}:${item.id}`}
                    id={optionId(index)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    className={cn(
                      "search-option",
                      index === activeIndex && "search-option-active",
                    )}
                    onPointerMove={() => {
                      if (index !== activeIndex) setActive(index);
                    }}
                    onClick={() => go(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") go(item);
                    }}
                  >
                    <Icon className="text-muted-foreground size-4" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{item.title}</span>
                      {item.detail !== undefined && (
                        <span className="text-muted-foreground truncate text-xs">
                          {item.detail}
                        </span>
                      )}
                    </span>
                    {item.match === "meaning" && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        similar
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!loading && error === null && options.length === 0 && query.trim() !== "" && (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            {NOTHING_MATCHES}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-destructive px-3 py-3 text-sm">
            {error}
          </p>
        )}
        {server !== null && !server.semantic && (tab === "all" || tab === "threads") && (
          <p className="text-muted-foreground px-3 py-2 text-xs">{WORDS_ONLY}</p>
        )}
      </div>

      <div className="border-border text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2.5 text-xs">
        <span>
          Close <kbd className="search-kbd">Esc</kbd>
        </span>
        <span>
          Change type <kbd className="search-kbd">←</kbd>{" "}
          <kbd className="search-kbd">→</kbd>
        </span>
        <span>
          Open <kbd className="search-kbd">↵</kbd>
        </span>
        <span className="ml-auto">{SEARCH_PRIVACY}</span>
      </div>
    </dialog>
  );
};
