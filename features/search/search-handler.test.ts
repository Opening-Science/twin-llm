import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import {
  createSearchHandlers,
  SEARCH_AUDIT_TOOL,
  SEARCH_COPY,
  type DocsSource,
  type SearchHandlerPorts,
  searchDocs,
} from "./search-handler";

const docs: DocsSource = {
  listPages: async () => [
    { slug: "genome", path: "genome.md", title: "Genome" },
    { slug: "warehouse", path: "warehouse.md", title: "Warehouse" },
  ],
  readText: async (path) =>
    ({
      "warehouse.md": "# Warehouse\n\nObservations and conditions as recorded.",
      "genome.md": "# Genome\n\nThe Ark keeps the VCF. Conditions are not inferred.",
    })[path] ?? null,
};

const setup = (overrides: Partial<SearchHandlerPorts> = {}) => {
  const audits: AppendInput[] = [];
  const searched: string[] = [];
  const ports: SearchHandlerPorts = {
    resolveActorId: async () => "clerk_1",
    findAppUserId: async () => "u1",
    searchThreads: async (userId, query) => {
      searched.push(`${userId}:${query}`);
      return {
        items: [{ kind: "thread", id: "t1", title: "BP", href: "/t/t1", match: "words" }],
        semantic: true,
      };
    },
    indexPending: async () => ({ indexed: 3, pending: 0, embedding: true }),
    docs,
    audit: async (event) => {
      audits.push(event);
    },
    logError: () => {},
    ...overrides,
  };
  return { handlers: createSearchHandlers(ports), audits, searched };
};

const get = (query: string) => new Request(`http://localhost/api/search?${query}`);

describe("GET /api/search", () => {
  test("signed out is refused and nothing is searched", async () => {
    const { handlers, searched } = setup({ resolveActorId: async () => null });
    const response = await handlers.GET(get("q=sleep"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: SEARCH_COPY.signIn });
    expect(searched).toEqual([]);
  });

  test("returns the person's threads and matching docs, audited without the query", async () => {
    const { handlers, audits, searched } = setup();
    const response = await handlers.GET(get("q=systolic%20pressure&tab=all"));
    const body = await response.json();
    expect(body.threads).toHaveLength(1);
    expect(body.semantic).toBe(true);
    expect(searched).toEqual(["u1:systolic pressure"]);
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    expect(audit?.tool).toBe(SEARCH_AUDIT_TOOL);
    expect(audit?.args).toEqual({ tab: "all", words: 2, semantic: true });
    expect(JSON.stringify(audit)).not.toContain("systolic");
  });

  test("the Docs tab reads no threads and writes no audit", async () => {
    const { handlers, audits, searched } = setup();
    const body = await (await handlers.GET(get("q=conditions&tab=docs"))).json();
    expect(searched).toEqual([]);
    expect(audits).toEqual([]);
    expect(body.docs.map((doc: { id: string }) => doc.id)).toEqual([
      "genome",
      "warehouse",
    ]);
  });

  test("an audit that cannot be written refuses the search", async () => {
    const { handlers } = setup({
      audit: async () => {
        throw new Error("db down");
      },
    });
    const response = await handlers.GET(get("q=sleep"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: SEARCH_COPY.failed });
  });

  test("an empty query answers empty without reading", async () => {
    const { handlers, searched } = setup();
    expect(await (await handlers.GET(get("q=%20"))).json()).toEqual({
      threads: [],
      docs: [],
      semantic: false,
    });
    expect(searched).toEqual([]);
  });
});

describe("POST /api/search", () => {
  test("indexes for the signed-in person", async () => {
    const { handlers } = setup();
    expect(await (await handlers.POST()).json()).toEqual({
      indexed: 3,
      pending: 0,
      embedding: true,
    });
  });

  test("signed out is refused", async () => {
    const { handlers } = setup({ resolveActorId: async () => null });
    expect((await handlers.POST()).status).toBe(401);
  });
});

describe("searchDocs", () => {
  test("title matches rank first; text matches carry a passage", async () => {
    const hits = await searchDocs(docs, "genome");
    expect(hits.map((hit) => [hit.id, hit.href])).toEqual([["genome", "/docs/genome"]]);
    const byText = await searchDocs(docs, "recorded");
    expect(byText[0]?.detail).toContain("as recorded");
  });
});
