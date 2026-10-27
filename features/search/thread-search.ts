import {
  blendThreadHits,
  type SearchItem,
  type SemanticHit,
  snippetAround,
  type ThreadHit,
} from "./search-model";

/**
 * Searching one person's threads (#167), behind ports so the rules are tested
 * without a database or a model:
 *
 * - Only the signed-in person's own threads, always (`userId` on every read).
 * - Word matches on titles, prompts and answers; meaning matches on the
 *   embeddings of prompts and answers. Embeddings come from Ollama on this
 *   machine only; when it is down the search still answers by words.
 * - A genome thread (#151) is found by its title only: no passage of it is
 *   shown, and it is never embedded. One indexed before it used genome tools
 *   loses its embeddings at the next index run.
 */

export const THREAD_RESULT_LIMIT = 12;
/** Rows each word read may return; enough to fill the list after de-duplication. */
export const WORD_READ_CAP = 25;
export const MEANING_READ_CAP = 20;
/** Characters of a prompt or answer that are embedded. */
export const EMBED_TEXT_CAP = 2000;

export type WordRow = Readonly<{
  threadId: string;
  title: string;
  updatedAt: Date;
  /** The prompt or answer text that matched; null for a title match. */
  text: string | null;
}>;

export type NearestRow = Readonly<{
  threadId: string;
  sourceKind: "prompt" | "answer";
  sourceId: string;
  distance: number;
}>;

export type SourceText = Readonly<{
  threadId: string;
  title: string;
  updatedAt: Date;
  text: string;
}>;

export type ThreadSearchPorts = Readonly<{
  wordRows: (userId: string, query: string, cap: number) => Promise<readonly WordRow[]>;
  /** Null when no local embedding is available. */
  embedQuery: (query: string) => Promise<readonly number[] | null>;
  nearest: (
    userId: string,
    vector: readonly number[],
    cap: number,
  ) => Promise<readonly NearestRow[]>;
  sourceTexts: (
    userId: string,
    rows: readonly NearestRow[],
  ) => Promise<ReadonlyMap<string, SourceText>>;
  /** Which of these threads are genome-personal. */
  genomeThreads: (threadIds: readonly string[]) => Promise<ReadonlySet<string>>;
}>;

export type ThreadSearchResult = Readonly<{
  items: readonly SearchItem[];
  /** False when the meaning search could not run (no local embedding). */
  semantic: boolean;
}>;

const sourceKey = (row: Pick<NearestRow, "sourceKind" | "sourceId">): string =>
  `${row.sourceKind}:${row.sourceId}`;

export const searchThreads = async (
  userId: string,
  query: string,
  ports: ThreadSearchPorts,
): Promise<ThreadSearchResult> => {
  const trimmed = query.trim();
  if (trimmed === "") return { items: [], semantic: false };

  const [words, vector] = await Promise.all([
    ports.wordRows(userId, trimmed, WORD_READ_CAP),
    ports.embedQuery(trimmed),
  ]);
  const near =
    vector === null ? [] : await ports.nearest(userId, vector, MEANING_READ_CAP);
  const genome = await ports.genomeThreads([
    ...new Set([...words.map((row) => row.threadId), ...near.map((row) => row.threadId)]),
  ]);

  const byWords: ThreadHit[] = words.flatMap((row) => {
    const isGenome = genome.has(row.threadId);
    // A genome thread may be found by its title, never by what was said in it.
    if (isGenome && row.text !== null) return [];
    return [
      {
        threadId: row.threadId,
        title: row.title,
        updatedAt: row.updatedAt.toISOString(),
        ...(row.text === null ? {} : { snippet: snippetAround(row.text, trimmed) }),
      },
    ];
  });

  const keptNear = near.filter((row) => !genome.has(row.threadId));
  const texts =
    keptNear.length === 0 ? new Map() : await ports.sourceTexts(userId, keptNear);
  const byMeaning: SemanticHit[] = keptNear.flatMap((row) => {
    const source = texts.get(sourceKey(row));
    if (source === undefined) return [];
    return [
      {
        threadId: row.threadId,
        title: source.title,
        updatedAt: source.updatedAt.toISOString(),
        snippet: snippetAround(source.text, trimmed),
        distance: row.distance,
      },
    ];
  });

  return {
    items: blendThreadHits(byWords, byMeaning, THREAD_RESULT_LIMIT),
    semantic: vector !== null,
  };
};

// ─── Indexing ────────────────────────────────────────────────────────────────

export type IndexSource = Readonly<{
  threadId: string;
  sourceKind: "prompt" | "answer";
  sourceId: string;
  text: string;
}>;

export type IndexPorts = Readonly<{
  /** The person's newest prompts and finished answers, at most `cap` of each. */
  recentSources: (userId: string, cap: number) => Promise<readonly IndexSource[]>;
  /** Which of these sources already have an embedding. */
  indexedKeys: (sources: readonly IndexSource[]) => Promise<ReadonlySet<string>>;
  genomeThreads: (threadIds: readonly string[]) => Promise<ReadonlySet<string>>;
  dropThreads: (userId: string, threadIds: readonly string[]) => Promise<void>;
  embedDocument: (text: string) => Promise<readonly number[] | null>;
  store: (
    userId: string,
    source: IndexSource,
    vector: readonly number[],
  ) => Promise<void>;
  now: () => number;
}>;

export type IndexRun = Readonly<{ indexed: number; pending: number; embedding: boolean }>;

/** Sources looked at per run; the newest first, so recent threads are found soonest. */
export const INDEX_SCAN_CAP = 200;

/**
 * Embeds what is new, newest first, until `max` items or `budgetMs` have
 * gone. Drops the embeddings of threads that have become genome threads.
 * Stops at the first failed embedding (Ollama down or the model missing) and
 * says so; the next run picks up where this one stopped.
 */
export const indexPending = async (
  userId: string,
  ports: IndexPorts,
  limits: Readonly<{ max: number; budgetMs: number }>,
): Promise<IndexRun> => {
  const started = ports.now();
  const sources = await ports.recentSources(userId, INDEX_SCAN_CAP);
  const genome = await ports.genomeThreads([...new Set(sources.map((s) => s.threadId))]);
  if (genome.size > 0) await ports.dropThreads(userId, [...genome]);

  const done = await ports.indexedKeys(sources);
  const todo = sources.filter(
    (source) =>
      !genome.has(source.threadId) &&
      !done.has(sourceKey(source)) &&
      source.text.trim() !== "",
  );

  let indexed = 0;
  for (const source of todo) {
    if (indexed >= limits.max || ports.now() - started > limits.budgetMs) break;
    const vector = await ports.embedDocument(source.text.slice(0, EMBED_TEXT_CAP));
    if (vector === null)
      return { indexed, pending: todo.length - indexed, embedding: false };
    await ports.store(userId, source, vector);
    indexed += 1;
  }
  return { indexed, pending: todo.length - indexed, embedding: true };
};
