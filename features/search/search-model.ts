/**
 * What the search box (#167) lists and how it ranks, as pure functions: the
 * dialog, the route and the tests share them.
 *
 * Threads come from the server, which blends keyword matches (titles, prompts,
 * answers) with semantic ones (embeddings of prompts and answers). Pages,
 * commands and actions are matched here, in the browser, by their words.
 */

export const SEARCH_TABS = ["all", "threads", "pages", "docs", "commands"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export const TAB_LABELS: Readonly<Record<SearchTab, string>> = {
  all: "All",
  threads: "Threads",
  pages: "Pages",
  docs: "Docs",
  commands: "Commands",
};

export type SearchItemKind = "thread" | "page" | "doc" | "command" | "action";

export type SearchItem = Readonly<{
  kind: SearchItemKind;
  id: string;
  title: string;
  /** A line under the title: a matching passage, a description, a path. */
  detail?: string;
  /** Where Enter goes. A command has none: it fills the prompt instead. */
  href?: string;
  /** How the thread matched, said in words beside it. */
  match?: "words" | "meaning";
}>;

const TAB_KINDS: Readonly<Record<SearchTab, readonly SearchItemKind[]>> = {
  all: ["thread", "page", "doc", "command", "action"],
  threads: ["thread"],
  pages: ["page"],
  docs: ["doc"],
  commands: ["command", "action"],
};

export const inTab = (tab: SearchTab, item: SearchItem): boolean =>
  TAB_KINDS[tab].includes(item.kind);

/** ←/→ (with no text selection to move through) cycle the tabs. */
export const nextTab = (tab: SearchTab, step: 1 | -1): SearchTab => {
  const index = SEARCH_TABS.indexOf(tab);
  return SEARCH_TABS[(index + step + SEARCH_TABS.length) % SEARCH_TABS.length] ?? "all";
};

const normalise = (text: string): string =>
  text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * How well `text` matches `query` by its words: 3 when it starts with the
 * query, 2 when a word starts with it, 1 when every query word appears
 * somewhere, 0 otherwise.
 */
export const wordScore = (query: string, text: string): number => {
  const q = normalise(query);
  const t = normalise(text);
  if (q === "") return 0;
  if (t.startsWith(q)) return 3;
  if (t.includes(` ${q}`)) return 2;
  return q.split(" ").every((word) => t.includes(word)) ? 1 : 0;
};

/** Static items (pages, docs, commands, actions) that match, best first, stable. */
export const matchItems = (
  query: string,
  items: readonly SearchItem[],
): readonly SearchItem[] =>
  items
    .map((item, order) => ({
      item,
      order,
      score: Math.max(
        wordScore(query, item.title),
        item.detail ? wordScore(query, item.detail) - 1 : 0,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ item }) => item);

export type ThreadHit = Readonly<{
  threadId: string;
  title: string;
  /** A passage of the prompt or answer that matched, when it was not the title. */
  snippet?: string;
  updatedAt: string;
}>;

export type SemanticHit = ThreadHit & Readonly<{ distance: number }>;

/**
 * Cosine distance under which a semantic match is shown. nomic-embed-text puts
 * unrelated short texts around 0.6 to 0.8 apart; related ones well under 0.5.
 */
export const SEMANTIC_MAX_DISTANCE = 0.5;

/**
 * One row per thread: word matches first (newest first), then threads that
 * only matched by meaning (closest first). A thread found both ways counts as
 * a word match, keeping the word match's snippet.
 */
export const blendThreadHits = (
  byWords: readonly ThreadHit[],
  byMeaning: readonly SemanticHit[],
  limit: number,
): readonly SearchItem[] => {
  const seen = new Set<string>();
  const words = [...byWords]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((hit) => !seen.has(hit.threadId) && seen.add(hit.threadId));
  const meaning = [...byMeaning]
    .filter((hit) => hit.distance <= SEMANTIC_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .filter((hit) => !seen.has(hit.threadId) && seen.add(hit.threadId));
  return [
    ...words.map((hit) => threadItem(hit, "words")),
    ...meaning.map((hit) => threadItem(hit, "meaning")),
  ].slice(0, limit);
};

const threadItem = (hit: ThreadHit, match: "words" | "meaning"): SearchItem => ({
  kind: "thread",
  id: hit.threadId,
  title: hit.title.trim() === "" ? "Thread" : hit.title,
  ...(hit.snippet ? { detail: hit.snippet } : {}),
  href: `/t/${hit.threadId}`,
  match,
});

const SNIPPET_RADIUS = 60;
const SNIPPET_LEAD = 24;

/**
 * The part of `text` around the first query word, on one line, with an
 * ellipsis where it was cut. Without a word match, the start of the text.
 */
export const snippetAround = (text: string, query: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  const words = normalise(query).split(" ").filter(Boolean);
  const lower = normalise(flat);
  const at = words.reduce<number>((found, word) => {
    if (found >= 0) return found;
    return lower.indexOf(word);
  }, -1);
  // A little before the word, more after it: the reader sees what follows the match.
  const start = Math.max(0, (at < 0 ? 0 : at) - SNIPPET_LEAD);
  const end = Math.min(flat.length, start + SNIPPET_RADIUS * 2 + 20);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
};
