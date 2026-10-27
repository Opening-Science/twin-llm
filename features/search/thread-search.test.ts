import { describe, expect, test } from "bun:test";

import {
  type IndexPorts,
  type IndexSource,
  indexPending,
  searchThreads,
  type ThreadSearchPorts,
} from "./thread-search";

const at = new Date("2026-10-20T10:00:00Z");

const ports = (overrides: Partial<ThreadSearchPorts> = {}): ThreadSearchPorts => ({
  wordRows: async () => [],
  embedQuery: async () => null,
  nearest: async () => [],
  sourceTexts: async () => new Map(),
  genomeThreads: async () => new Set(),
  ...overrides,
});

describe("searchThreads", () => {
  test("an empty query reads nothing", async () => {
    const calls: string[] = [];
    const result = await searchThreads(
      "u1",
      "   ",
      ports({
        wordRows: async () => {
          calls.push("words");
          return [];
        },
      }),
    );
    expect(result).toEqual({ items: [], semantic: false });
    expect(calls).toEqual([]);
  });

  test("every read is scoped to the caller", async () => {
    const users: string[] = [];
    await searchThreads(
      "u1",
      "sleep",
      ports({
        wordRows: async (userId) => {
          users.push(userId);
          return [];
        },
        embedQuery: async () => [0.1],
        nearest: async (userId) => {
          users.push(userId);
          return [
            { threadId: "t1", sourceKind: "prompt", sourceId: "p1", distance: 0.2 },
          ];
        },
        sourceTexts: async (userId) => {
          users.push(userId);
          return new Map();
        },
      }),
    );
    expect(users).toEqual(["u1", "u1", "u1"]);
  });

  test("without a local embedding it answers by words and says so", async () => {
    const result = await searchThreads(
      "u1",
      "systolic",
      ports({
        wordRows: async () => [
          {
            threadId: "t1",
            title: "BP question",
            updatedAt: at,
            text: "latest systolic value",
          },
        ],
      }),
    );
    expect(result.semantic).toBe(false);
    expect(result.items).toEqual([
      {
        kind: "thread",
        id: "t1",
        title: "BP question",
        detail: "latest systolic value",
        href: "/t/t1",
        match: "words",
      },
    ]);
  });

  test("meaning matches add threads the words missed, with a passage", async () => {
    const result = await searchThreads(
      "u1",
      "blood pressure",
      ports({
        embedQuery: async () => [0.1, 0.2],
        nearest: async () => [
          { threadId: "t2", sourceKind: "answer", sourceId: "r9", distance: 0.3 },
        ],
        sourceTexts: async () =>
          new Map([
            [
              "answer:r9",
              {
                threadId: "t2",
                title: "Hypertension",
                updatedAt: at,
                text: "systolic 131 mm[Hg]",
              },
            ],
          ]),
      }),
    );
    expect(result.semantic).toBe(true);
    expect(result.items.map((item) => [item.id, item.match, item.detail])).toEqual([
      ["t2", "meaning", "systolic 131 mm[Hg]"],
    ]);
  });

  test("a genome thread is found by its title only, never by its content", async () => {
    const result = await searchThreads(
      "u1",
      "variant",
      ports({
        wordRows: async () => [
          { threadId: "g1", title: "Genome variant summary", updatedAt: at, text: null },
          {
            threadId: "g1",
            title: "Genome variant summary",
            updatedAt: at,
            text: "rs123 AG",
          },
          { threadId: "g2", title: "Other", updatedAt: at, text: "variant rs456" },
        ],
        embedQuery: async () => [0.1],
        nearest: async () => [
          { threadId: "g2", sourceKind: "answer", sourceId: "r1", distance: 0.1 },
        ],
        sourceTexts: async () => {
          throw new Error("a genome passage must not be read");
        },
        genomeThreads: async () => new Set(["g1", "g2"]),
      }),
    );
    expect(result.items).toEqual([
      {
        kind: "thread",
        id: "g1",
        title: "Genome variant summary",
        href: "/t/g1",
        match: "words",
      },
    ]);
  });
});

describe("indexPending", () => {
  const source = (n: number, threadId = "t1"): IndexSource => ({
    threadId,
    sourceKind: n % 2 === 0 ? "prompt" : "answer",
    sourceId: `s${n}`,
    text: `text ${n}`,
  });

  const indexPorts = (
    sources: readonly IndexSource[],
    overrides: Partial<IndexPorts> = {},
  ): IndexPorts & { stored: string[]; dropped: string[] } => {
    const stored: string[] = [];
    const dropped: string[] = [];
    return {
      stored,
      dropped,
      recentSources: async () => sources,
      indexedKeys: async () => new Set(["prompt:s0"]),
      genomeThreads: async () => new Set(),
      dropThreads: async (_userId, ids) => {
        dropped.push(...ids);
      },
      embedDocument: async () => [0.5],
      store: async (_userId, item) => {
        stored.push(item.sourceId);
      },
      now: () => 0,
      ...overrides,
    };
  };

  test("embeds only what is new, up to the limit", async () => {
    const run = indexPorts([source(0), source(1), source(2), source(3)]);
    expect(await indexPending("u1", run, { max: 2, budgetMs: 1000 })).toEqual({
      indexed: 2,
      pending: 1,
      embedding: true,
    });
    expect(run.stored).toEqual(["s1", "s2"]);
  });

  test("genome threads are never embedded, and their old embeddings are dropped", async () => {
    const run = indexPorts([source(1, "g1"), source(3, "t1")], {
      genomeThreads: async () => new Set(["g1"]),
    });
    await indexPending("u1", run, { max: 10, budgetMs: 1000 });
    expect(run.stored).toEqual(["s3"]);
    expect(run.dropped).toEqual(["g1"]);
  });

  test("a failed embedding stops the run and reports it", async () => {
    const run = indexPorts([source(1), source(3)], { embedDocument: async () => null });
    expect(await indexPending("u1", run, { max: 10, budgetMs: 1000 })).toEqual({
      indexed: 0,
      pending: 2,
      embedding: false,
    });
  });

  test("the time budget stops the run between items", async () => {
    let clock = 0;
    const run = indexPorts([source(1), source(3), source(5)], {
      now: () => clock,
      embedDocument: async () => {
        clock += 600;
        return [0.5];
      },
    });
    expect((await indexPending("u1", run, { max: 10, budgetMs: 1000 })).indexed).toBe(2);
  });
});
