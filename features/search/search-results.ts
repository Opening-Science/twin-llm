import { RECENTS_LIMIT, type RecentThread } from "@/infrastructure/recent-threads";

import type { StaticSearchItems } from "./search-items";
import { inTab, matchItems, type SearchItem, type SearchTab } from "./search-model";

/**
 * What the search box shows for a query and a tab, as groups in a fixed
 * order: Threads (Recents before anything is typed), Pages, Docs, Commands,
 * Actions. Pure; the dialog brings the server's answer and the recents.
 */

export type ServerAnswer = Readonly<{
  threads: readonly SearchItem[];
  docs: readonly SearchItem[];
  /** False when meaning search was off (no local embedding model). */
  semantic: boolean;
}>;

export type ResultGroup = Readonly<{ title: string; items: readonly SearchItem[] }>;

/** The server is asked only for a typed query on a tab that shows its kinds. */
export const wantsServer = (query: string, tab: SearchTab): boolean =>
  query.trim() !== "" && (tab === "all" || tab === "threads" || tab === "docs");

/** The first recents, which already leave out threads whose delete is pending. */
export const recentItems = (recents: readonly RecentThread[]): readonly SearchItem[] =>
  recents.slice(0, RECENTS_LIMIT).map((thread) => ({
    kind: "thread",
    id: thread.id,
    title: thread.title.trim() === "" ? "Thread" : thread.title,
    href: `/t/${encodeURIComponent(thread.id)}`,
  }));

export const resultGroups = (
  input: Readonly<{
    query: string;
    tab: SearchTab;
    recents: readonly RecentThread[];
    statics: StaticSearchItems;
    server: ServerAnswer | null;
  }>,
): readonly ResultGroup[] => {
  const { query, tab, recents, statics, server } = input;
  const groups: readonly ResultGroup[] =
    query.trim() === ""
      ? [
          { title: "Recents", items: recentItems(recents) },
          { title: "Actions", items: statics.actions },
        ]
      : [
          { title: "Threads", items: server?.threads ?? [] },
          { title: "Pages", items: matchItems(query, statics.pages) },
          { title: "Docs", items: server?.docs ?? [] },
          { title: "Commands", items: matchItems(query, statics.commands) },
          { title: "Actions", items: matchItems(query, statics.actions) },
        ];
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => inTab(tab, item)) }))
    .filter((group) => group.items.length > 0);
};

/** The server's answer, or the sentence to show instead. */
export const readServerAnswer = (
  ok: boolean,
  body: unknown,
): ServerAnswer | Readonly<{ error: string }> => {
  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (ok && Array.isArray(record.threads) && Array.isArray(record.docs)) {
    return {
      threads: record.threads as SearchItem[],
      docs: record.docs as SearchItem[],
      semantic: record.semantic === true,
    };
  }
  return {
    error: typeof record.error === "string" ? record.error : SEARCH_FAILED,
  };
};

export const SEARCH_FAILED = "Search didn't work just now.";
export const NOTHING_MATCHES = "Nothing matches that yet.";
export const WORDS_ONLY =
  "Matching by words only. Start Ollama with the embedding model to match by meaning too.";
export const SEARCH_PRIVACY = "Only your own threads. Matched on this machine.";
