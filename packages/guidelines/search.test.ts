import { beforeEach, describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AppendInput } from "@/packages/audit/append";

import { drainGuidelineTurn, resetGuidelineCollectorForTests } from "./collector";
import { EMBEDDING_DIM, GUIDELINE_AUDIT_TOOL } from "./constants";
import { guidelineSearchInput } from "./input";
import {
  queryNearestChunks,
  runGuidelineSearch,
  toGuidelineHit,
  type GuidelineJoinedRow,
} from "./search";

const scope = {
  actor: "actor-gl-1",
  sessionId: "turn-gl-1",
  mode: "personal" as const,
};

const vector = Array.from({ length: EMBEDDING_DIM }, (_, index) => index / EMBEDDING_DIM);

const fullTextRow = (overrides?: Partial<GuidelineJoinedRow>): GuidelineJoinedRow => ({
  id: "chunk-als-1",
  sectionHeading: "Non-invasive ventilation",
  recommendationId: "R3",
  recClass: "Strong",
  evidenceLevel: "moderate",
  page: "12",
  text: "Offer NIV when respiratory function declines.",
  documentId: "ean-als-2024",
  title: "EAN/ERN EURO-NMD ALS",
  year: 2024,
  society: "EAN",
  doi: "10.1111/ene.example",
  url: "https://example.org/ean-als-2024",
  licence: "cc-by-nc-nd-4.0",
  ingestMode: "full_text",
  ...overrides,
});

const citeOnlyRow = (): GuidelineJoinedRow =>
  fullTextRow({
    id: "chunk-esc-1",
    documentId: "esc-pe-2019",
    title: "ESC acute pulmonary embolism",
    year: 2019,
    society: "ESC",
    doi: "10.1093/eurheartj/example",
    url: "https://example.org/esc-pe-2019",
    licence: "esc-oup",
    ingestMode: "cite_only",
    text: "This body must never reach the model.",
  });

const recordingAppend =
  (calls: AppendInput[]) => async (_db: PrismaClient, input: AppendInput) => {
    calls.push(input);
    return {
      seq: BigInt(calls.length),
      hash: `h${calls.length}`,
      argsSha256: "a".repeat(64),
      resultSha256: "b".repeat(64),
    };
  };

describe("toGuidelineHit licence strip", () => {
  test("full_text keeps the passage", () => {
    expect(toGuidelineHit(fullTextRow()).passage).toBe(
      "Offer NIV when respiratory function declines.",
    );
  });

  test("cite_only hits return passage null", () => {
    const hit = toGuidelineHit(citeOnlyRow());
    expect(hit.passage).toBeNull();
    expect(hit.id).toBe("esc-pe-2019");
    expect(hit.ingestMode).toBe("cite_only");
  });
});

describe("queryNearestChunks source filter", () => {
  test("enables iterative scan in the same transaction, then filters on source", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const tx = {
      $executeRaw: async (query: { sql: string; values: unknown[] }) => {
        statements.push({ sql: query.sql, values: query.values });
        return 0;
      },
      $queryRaw: async (query: { sql: string; values: unknown[] }) => {
        statements.push({ sql: query.sql, values: query.values });
        return [];
      },
    };
    const db = {
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as PrismaClient;
    await queryNearestChunks(db, vector, 4, "guideline");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toEqual({
      sql: "SET LOCAL hnsw.iterative_scan = relaxed_order",
      values: [],
    });
    expect(statements[1]?.sql).toContain("WHERE d.source = ?");
    expect(statements[1]?.sql).toContain("ORDER BY distance");
    expect(statements[1]?.values).toEqual(["guideline", 4]);
  });
});

describe("runGuidelineSearch", () => {
  beforeEach(() => {
    resetGuidelineCollectorForTests();
  });

  test("embeds with the query, audits subjectRef null, and records citations without passage", async () => {
    const calls: AppendInput[] = [];
    const embedded: string[] = [];
    const input = guidelineSearchInput.parse({ query: "ALS NIV", k: 3 });
    const hits = await runGuidelineSearch(scope, input, {
      embed: async (query) => {
        embedded.push(query);
        return vector;
      },
      search: async (embedding, k) => {
        expect(embedding).toEqual(vector);
        expect(k).toBe(3);
        return [fullTextRow()];
      },
      append: recordingAppend(calls),
      database: () => ({}) as PrismaClient,
    });

    expect(embedded).toEqual(["ALS NIV"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.passage).toContain("NIV");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe(GUIDELINE_AUDIT_TOOL);
    expect(calls[0]?.subjectRef).toBeNull();
    expect(calls[0]?.args).toEqual(input);
    expect(calls[0]?.rowCount).toBe(1);

    const drained = drainGuidelineTurn(scope.sessionId);
    expect(drained.sources).toHaveLength(1);
    expect(drained.sources[0]).not.toHaveProperty("passage");
    expect(drained.sources[0]?.id).toBe("ean-als-2024");
    expect(drainGuidelineTurn(scope.sessionId).sources).toEqual([]);
  });

  test("strips cite_only passage before the model and the collector", async () => {
    const calls: AppendInput[] = [];
    const hits = await runGuidelineSearch(
      scope,
      guidelineSearchInput.parse({ query: "pulmonary embolism" }),
      {
        embed: async () => vector,
        search: async () => [citeOnlyRow()],
        append: recordingAppend(calls),
        database: () => ({}) as PrismaClient,
      },
    );
    expect(hits[0]?.passage).toBeNull();
    expect(JSON.stringify(calls[0]?.result)).not.toContain("never reach the model");
    expect(drainGuidelineTurn(scope.sessionId).sources[0]).not.toHaveProperty("passage");
  });

  test("fails closed when embed returns empty and still audits", async () => {
    const calls: AppendInput[] = [];
    const hits = await runGuidelineSearch(
      scope,
      guidelineSearchInput.parse({ query: "ALS" }),
      {
        embed: async () => null,
        search: async () => {
          throw new Error("search must not run");
        },
        append: recordingAppend(calls),
        database: () => ({}) as PrismaClient,
      },
    );
    expect(hits).toEqual([]);
    expect(calls[0]?.subjectRef).toBeNull();
    expect(calls[0]?.tool).toBe(GUIDELINE_AUDIT_TOOL);
    expect(calls[0]?.rowCount).toBe(0);
    expect(calls[0]?.result).toEqual({ error: "guideline-embed-failed" });
  });

  test("fails closed on search errors and still audits", async () => {
    const calls: AppendInput[] = [];
    const hits = await runGuidelineSearch(
      scope,
      guidelineSearchInput.parse({ query: "ALS" }),
      {
        embed: async () => vector,
        search: async () => {
          throw new Error("connect ECONNREFUSED");
        },
        append: recordingAppend(calls),
        database: () => ({}) as PrismaClient,
      },
    );
    expect(hits).toEqual([]);
    expect(calls[0]?.rowCount).toBe(0);
    expect(calls[0]?.result).toEqual({ error: "connect ECONNREFUSED" });
  });
});
