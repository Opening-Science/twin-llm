"use client";

import { useRouter } from "next/navigation";
import {
  type ComponentType,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  inTab,
  matchItems,
  nextTab,
  SEARCH_TABS,
  type SearchItem,
  type SearchItemKind,
  type SearchTab,
  TAB_LABELS,
} from "@/features/search/search-model";
import { cn } from "@/infrastructure/ui";

import {
  CommandGlyph,
  CrossGlyph,
  DocsGlyph,
  PlusGlyph,
  SearchGlyph,
  ThreadGlyph,
} from "./glyphs";

/**
 * The search box (#167): Ctrl/⌘+K anywhere in the shell, or the sidebar's
 * Search row. A native modal `<dialog>`: the browser keeps focus inside,
 * closes it on Escape and makes the page behind inert.
 *
 * Empty, it lists recent threads and actions. Typing searches the person's
 * threads and the docs on the server (debounced, the previous request
 * aborted) and matches pages, commands and actions here. ↑/↓ move, Enter
 * opens, ←/→ at either end of the text change the tab. Opening it asks the
 * server to embed what is new, so meaning matches cover the latest answers.
 */

const DEBOUNCE_MS = 180;

type Remote = Readonly<{
  query: string;
  threads: readonly SearchItem[];
  docs: readonly SearchItem[];
  semantic: boolean;
  error?: string;
}>;

const EMPTY_REMOTE: Remote = { query: "", threads: [], docs: [], semantic: true };

const GLYPHS: Readonly<Record<SearchItemKind, ComponentType<{ className?: string }>>> = {
  thread: ThreadGlyph,
  page: SearchGlyph,
  doc: DocsGlyph,
  command: CommandGlyph,
  action: PlusGlyph,
};

const SECTION_TITLES: Readonly<Record<SearchItemKind, string>> = {
  thread: "Threads",
  page: "Pages",
  doc: "Docs",
  command: "Commands",
  action: "Actions",
};

export const isSearchShortcut = (
  event: Readonly<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>,
): boolean =>
  event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey;

/** The rows to show, grouped in a fixed order of kinds. */
export const visibleSections = (
  query: string,
  tab: SearchTab,
  remote: Remote,
  recents: readonly SearchItem[],
  statics: readonly SearchItem[],
): readonly Readonly<{
  kind: SearchItemKind;
  title: string;
  items: readonly SearchItem[];
}>[] => {
  const trimmed = query.trim();
  const pool: readonly SearchItem[] =
    trimmed === ""
      ? [...recents, ...statics.filter((item) => item.kind === "action")]
      : [
          ...(remote.query === trimmed ? remote.threads : []),
          ...matchItems(
            trimmed,
            statics.filter((item) => item.kind === "page"),
          ),
          ...(remote.query === trimmed ? remote.docs : []),
          ...matchItems(
            trimmed,
            statics.filter((item) => item.kind === "command" || item.kind === "action"),
          ),
        ];
  const kinds: readonly SearchItemKind[] = ["thread", "page", "doc", "command", "action"];
  return kinds
    .map((kind) => ({
      kind,
      title: trimmed === "" && kind === "thread" ? "Recents" : SECTION_TITLES[kind],
      items: pool.filter((item) => item.kind === kind && inTab(tab, item)),
    }))
    .filter((section) => section.items.length > 0);
};

const optionId = (item: SearchItem) => `search-option-${item.kind}-${item.id}`;

export const SearchDialog = ({
  open,
  onClose,
  recents,
  statics,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  recents: readonly SearchItem[];
  statics: readonly SearchItem[];
}>) => {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [remote, setRemote] = useState<Remote>(EMPTY_REMOTE);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    element.showModal();
    input.current?.focus();
    // Embed what is new while the person types; failures only mean fewer meaning matches.
    void fetch("/api/search", { method: "POST" }).catch(() => {});
    return () => {
      if (element.open) element.close();
    };
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed === "" || tab === "pages" || tab === "commands") {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed, tab });
      fetch(`/api/search?${params}`, { signal: abort.signal })
        .then(async (response) => {
          const body = (await response.json()) as Partial<Remote> & { error?: string };
          setRemote(
            response.ok
              ? {
                  query: trimmed,
                  threads: body.threads ?? [],
                  docs: body.docs ?? [],
                  semantic: body.semantic ?? false,
                }
              : { ...EMPTY_REMOTE, query: trimmed, error: body.error },
          );
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setRemote({
            ...EMPTY_REMOTE,
            query: trimmed,
            error: "Search didn't work just now.",
          });
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, query, tab]);

  const sections = useMemo(
    () => visibleSections(query, tab, remote, recents, statics),
    [query, tab, remote, recents, statics],
  );
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => setActive(0), [query, tab]);

  const close = () => {
    dialog.current?.close();
  };
  const go = (item: SearchItem | undefined) => {
    if (!item?.href) return;
    close();
    router.push(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(current);
    } else if (
      (event.key === "ArrowRight" && field.selectionStart === field.value.length) ||
      (event.key === "ArrowLeft" && field.selectionEnd === 0)
    ) {
      event.preventDefault();
      setTab((value) => nextTab(value, event.key === "ArrowRight" ? 1 : -1));
    }
  };

  const showsMeaningNote =
    query.trim() !== "" &&
    remote.query === query.trim() &&
    !remote.semantic &&
    (tab === "all" || tab === "threads");

  return (
    // The click handler only catches backdrop clicks; Escape closes it for keyboards.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      aria-label="Search"
      className="search-dialog"
      onClose={() => {
        setQuery("");
        setTab("all");
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <SearchGlyph className="text-muted-foreground size-4 shrink-0" />
        <input
          ref={input}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search threads, pages, docs and commands"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-autocomplete="list"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        <button
          type="button"
          aria-label="Close search"
          onClick={close}
          className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg p-1.5"
        >
          <CrossGlyph className="size-4" />
        </button>
      </div>

      <div role="tablist" aria-label="What to search" className="flex gap-1 px-4 pb-3">
        {SEARCH_TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value);
              input.current?.focus();
            }}
            className="search-tab"
          >
            {TAB_LABELS[value]}
          </button>
        ))}
      </div>

      <div
        id="search-results"
        role="listbox"
        aria-label="Results"
        aria-busy={loading}
        className="border-border max-h-[min(60vh,28rem)] overflow-y-auto border-t px-2 py-2"
      >
        {sections.map((section) => (
          <div
            key={section.kind}
            role="group"
            aria-label={section.title}
            className="mb-1"
          >
            <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs">
              {section.title}
            </p>
            {section.items.map((item) => {
              const Glyph = GLYPHS[item.kind];
              const selected = item === current;
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={optionId(item)}
                  id={optionId(item)}
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onClick={() => go(item)}
                  onPointerMove={() => setActive(flat.indexOf(item))}
                  className={cn("search-option", selected && "search-option-active")}
                >
                  <Glyph className="text-muted-foreground size-4 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.title}</span>
                    {item.detail ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {item.detail}
                      </span>
                    ) : null}
                  </span>
                  {item.match === "meaning" ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      similar
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {sections.length === 0 && query.trim() !== "" && !loading ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            {remote.error ?? "Nothing matches that yet."}
          </p>
        ) : null}
        {showsMeaningNote ? (
          <p className="text-muted-foreground px-3 pt-1 pb-2 text-xs">
            Matching by words only: start Ollama with nomic-embed-text to also match by
            meaning.
          </p>
        ) : null}
      </div>

      <div className="border-border text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-5 py-2.5 text-xs">
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
        <span className="ml-auto">Only your own threads. Matched on this machine.</span>
      </div>
    </dialog>
  );
};
