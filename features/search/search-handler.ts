import { randomUUID } from "node:crypto";

import type { AppendInput } from "@/packages/audit/append";

import {
  SEARCH_TABS,
  type SearchItem,
  type SearchTab,
  snippetAround,
  wordScore,
} from "./search-model";
import type { IndexRun, ThreadSearchResult } from "./thread-search";

/**
 * `GET /api/search?q=&tab=` and `POST /api/search` (index what is new), as
 * factories over ports so the route rules are tested without a server.
 *
 * Threads are the person's own and need a signed-in actor. Each thread search
 * is audited before the answer goes out: the tab and the number of words and
 * results, never the query itself. When that audit cannot be written, the
 * search is refused, like any other read of personal data.
 */

export const SEARCH_AUDIT_TOOL = "search.threads" as const;
export const QUERY_MAX_CHARS = 200;
export const DOC_RESULT_LIMIT = 8;

export const SEARCH_COPY = {
  signIn: "Sign in to search your threads.",
  failed: "Search didn't work just now. Try again.",
} as const;

export type SearchResponse = Readonly<{
  threads: readonly SearchItem[];
  docs: readonly SearchItem[];
  /** False when meaning search was off for this query (no local embedding). */
  semantic: boolean;
}>;

/** The docs pages and their text; the route passes the Docs page's own readers. */
export type DocsSource = Readonly<{
  listPages: () => Promise<
    readonly Readonly<{ slug: string; path: string; title: string }>[]
  >;
  readText: (path: string) => Promise<string | null>;
}>;

export type SearchHandlerPorts = Readonly<{
  resolveActorId: () => Promise<string | null>;
  findAppUserId: (actor: string) => Promise<string | null>;
  searchThreads: (userId: string, query: string) => Promise<ThreadSearchResult>;
  indexPending: (userId: string) => Promise<IndexRun>;
  docs: DocsSource;
  audit: (event: AppendInput) => Promise<unknown>;
  logError: (message: string, error: unknown) => void;
}>;

const parseTab = (value: string | null): SearchTab =>
  SEARCH_TABS.find((tab) => tab === value) ?? "all";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Doc pages whose title or text has the query's words, title matches first. */
export const searchDocs = async (
  files: DocsSource,
  query: string,
): Promise<readonly SearchItem[]> => {
  const pages = await files.listPages();
  const scored = await Promise.all(
    pages.map(async (page) => {
      const byTitle = wordScore(query, page.title);
      if (byTitle > 0) return { page, score: byTitle + 3, snippet: undefined };
      const text = (await files.readText(page.path)) ?? "";
      return wordScore(query, text) > 0
        ? { page, score: 1, snippet: snippetAround(text, query) }
        : null;
    }),
  );
  return scored
    .filter((hit) => hit !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, DOC_RESULT_LIMIT)
    .map(({ page, snippet }) => ({
      kind: "doc" as const,
      id: page.slug,
      title: page.title,
      detail: snippet ?? page.path,
      href: `/docs/${page.slug}`,
    }));
};

export const createSearchHandlers = (ports: SearchHandlerPorts) => {
  const GET = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, QUERY_MAX_CHARS);
    const tab = parseTab(url.searchParams.get("tab"));
    const actor = await ports.resolveActorId();
    if (actor === null) return json({ error: SEARCH_COPY.signIn }, 401);
    if (query === "") return json({ threads: [], docs: [], semantic: false });

    try {
      const wantsThreads = tab === "all" || tab === "threads";
      const wantsDocs = tab === "all" || tab === "docs";
      const userId = wantsThreads ? await ports.findAppUserId(actor) : null;
      const [threads, docs] = await Promise.all([
        userId === null
          ? Promise.resolve<ThreadSearchResult>({ items: [], semantic: false })
          : ports.searchThreads(userId, query),
        wantsDocs ? searchDocs(ports.docs, query) : Promise.resolve([]),
      ]);
      if (userId !== null) {
        await ports.audit({
          actor,
          sessionId: randomUUID(),
          subjectRef: null,
          tool: SEARCH_AUDIT_TOOL,
          args: { tab, words: query.split(/\s+/).length, semantic: threads.semantic },
          result: { threads: threads.items.length },
          rowCount: threads.items.length,
        });
      }
      const body: SearchResponse = {
        threads: threads.items,
        docs,
        semantic: threads.semantic,
      };
      return json(body);
    } catch (error) {
      ports.logError("[search] query failed", error);
      return json({ error: SEARCH_COPY.failed }, 500);
    }
  };

  /** Embeds what is new since the last run; the dialog calls it when it opens. */
  const POST = async (): Promise<Response> => {
    const actor = await ports.resolveActorId();
    if (actor === null) return json({ error: SEARCH_COPY.signIn }, 401);
    try {
      const userId = await ports.findAppUserId(actor);
      if (userId === null) return json({ indexed: 0, pending: 0, embedding: true });
      return json(await ports.indexPending(userId));
    } catch (error) {
      ports.logError("[search] indexing failed", error);
      return json({ error: SEARCH_COPY.failed }, 500);
    }
  };

  return { GET, POST };
};
