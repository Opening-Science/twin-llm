import { beforeEach, describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AppendInput } from "@/packages/audit/append";
import { EMBEDDING_DIM } from "@/packages/guidelines/constants";
import type { GuidelineJoinedRow } from "@/packages/guidelines/search";

import { drainKnowledgeTurn, resetKnowledgeCollectorForTests } from "./collector";
import { runKnowledgeSearch, type KnowledgeSearchPorts } from "./search";

const scope = { actor: "actor-kn-1", sessionId: "turn-kn-1", mode: "synthetic" as const };
const vector = Array.from({ length: EMBEDDING_DIM }, (_, index) => index / EMBEDDING_DIM);

const hrvRow: GuidelineJoinedRow = {
  id: "opentwin-metric-glossary-1",
  sectionHeading: "Heart rate variability (HRV)",
  recommendationId: null,
  recClass: null,
  evidenceLevel: null,
  page: null,
  text: "Metric glossary · Heart rate variability (HRV)\n\nHRV is the variation in time between consecutive heartbeats.",
  documentId: "opentwin-metric-glossary",
  title: "Metric glossary",
  year: 2026,
  society: "Open Science Foundation",
  doi: "",
  url: "knowledge/opentwin/metric-glossary.md",
  licence: "cc-by-4.0",
  ingestMode: "full_text",
};

const ports = (
  calls: AppendInput[],
  overrides: Partial<KnowledgeSearchPorts> = {},
): KnowledgeSearchPorts => ({
  embed: async () => vector,
  search: async () => [hrvRow],
  append: async (_db: PrismaClient, input: AppendInput) => {
    calls.push(input);
    return { seq: BigInt(calls.length), hash: "h", argsSha256: "a", resultSha256: "b" };
  },
  database: () => ({}) as PrismaClient,
  ...overrides,
});

beforeEach(() => {
  resetKnowledgeCollectorForTests();
});

describe("runKnowledgeSearch", () => {
  test("returns passages, audits the call and records citations for the turn", async () => {
    const calls: AppendInput[] = [];
    const hits = await runKnowledgeSearch(
      scope,
      { query: "what does HRV measure?", k: 3 },
      ports(calls),
    );
    expect(hits).toEqual([
      {
        id: "opentwin-metric-glossary",
        title: "Metric glossary",
        file: "knowledge/opentwin/metric-glossary.md",
        sectionHeading: "Heart rate variability (HRV)",
        licence: "cc-by-4.0",
        passage: hrvRow.text,
      },
    ]);
    expect(calls).toEqual([
      {
        actor: "actor-kn-1",
        sessionId: "turn-kn-1",
        subjectRef: null,
        tool: "knowledge.knowledge_search",
        args: { query: "what does HRV measure?", k: 3 },
        result: hits,
        rowCount: 1,
      },
    ]);
    expect(drainKnowledgeTurn("turn-kn-1").sources).toEqual([
      {
        tool: "knowledge.knowledge_search",
        id: "opentwin-metric-glossary",
        title: "Metric glossary",
        file: "knowledge/opentwin/metric-glossary.md",
        sectionHeading: "Heart rate variability (HRV)",
        licence: "cc-by-4.0",
      },
    ]);
  });

  test("a failed embedding is audited with a marker and no hits", async () => {
    const calls: AppendInput[] = [];
    const hits = await runKnowledgeSearch(
      scope,
      { query: "hrv", k: 5 },
      ports(calls, { embed: async () => null }),
    );
    expect(hits).toEqual([]);
    expect(calls.map((call) => [call.result, call.rowCount])).toEqual([
      [{ error: "knowledge-embed-failed" }, 0],
    ]);
  });

  test("a search failure stores a marker, never the error text", async () => {
    const calls: AppendInput[] = [];
    const hits = await runKnowledgeSearch(
      scope,
      { query: "hrv", k: 5 },
      ports(calls, {
        search: async () => {
          throw new Error("connect ECONNREFUSED postgresql://user:secret@127.0.0.1");
        },
      }),
    );
    expect(hits).toEqual([]);
    expect(calls.map((call) => [call.result, call.rowCount])).toEqual([
      [{ error: "knowledge-search-failed" }, 0],
    ]);
    expect(drainKnowledgeTurn("turn-kn-1").sources).toEqual([]);
  });
});
