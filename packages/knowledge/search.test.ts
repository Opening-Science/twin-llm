import { beforeEach, describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AppendInput } from "@/packages/audit/append";
import { EMBEDDING_DIM } from "@/packages/guidelines/constants";
import type { GuidelineJoinedRow } from "@/packages/guidelines/search";

import {
  drainLiteratureTurn,
  resetLiteratureCollectorForTests,
} from "@/packages/literature/collector";

import { drainKnowledgeTurn, resetKnowledgeCollectorForTests } from "./collector";
import {
  knowledgeSearchSources,
  runKnowledgeSearch,
  toKnowledgeSearchHit,
  type KnowledgeSearchPorts,
} from "./search";

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
  source: "opentwin-knowledge",
};

/** A made-up article row; the PMC id is not a real one. */
const dietRow: GuidelineJoinedRow = {
  id: "lit-diet-PMC0000002.1-3",
  sectionHeading: "Results",
  recommendationId: null,
  recClass: null,
  evidenceLevel: null,
  page: null,
  text: "Synthetic diet article · Fibre intake was recorded for 12 weeks.",
  documentId: "lit-diet-PMC0000002.1",
  title: "Synthetic diet article",
  year: 2023,
  society: "J Synth Nutr",
  doi: "10.0000/synthetic",
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000002/",
  licence: "cc-by-nc-nd",
  ingestMode: "full_text",
  source: "literature:diet",
};

const sleepRow: GuidelineJoinedRow = {
  ...dietRow,
  id: "lit-sleep-PMC0000003.1-1",
  documentId: "lit-sleep-PMC0000003.1",
  title: "Synthetic sleep article",
  text: "Synthetic sleep article · Bedtime varied by 40 minutes.",
  licence: "cc-by",
  source: "literature:sleep",
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
  resetLiteratureCollectorForTests();
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

describe("knowledge search on an agent's turn (#236)", () => {
  test("knowledgeSearchSources: the notes, then the agent's literature", () => {
    expect(knowledgeSearchSources()).toEqual(["opentwin-knowledge"]);
    expect(knowledgeSearchSources(["literature:diet"])).toEqual([
      "opentwin-knowledge",
      "literature:diet",
    ]);
  });

  test("toKnowledgeSearchHit drops guideline rows and literature not asked for", () => {
    expect(toKnowledgeSearchHit({ ...hrvRow, source: "guideline" }, [])).toBeNull();
    expect(toKnowledgeSearchHit(dietRow, [])).toBeNull();
    expect(toKnowledgeSearchHit(dietRow, ["literature:sleep"])).toBeNull();
    expect(toKnowledgeSearchHit(dietRow, ["literature:diet"])?.id).toBe(
      "lit-diet-PMC0000002.1",
    );
  });

  test("a plain turn asks for the notes only", async () => {
    const asked: (readonly string[])[] = [];
    await runKnowledgeSearch(
      scope,
      { query: "hrv", k: 5 },
      ports([], {
        search: async (_embedding, _k, sources) => {
          asked.push(sources);
          return [hrvRow];
        },
      }),
    );
    expect(asked).toEqual([["opentwin-knowledge"]]);
    expect(drainLiteratureTurn("turn-kn-1").sources).toEqual([]);
  });

  test("an agent's turn gets notes and its literature, each hit with title, PMC id and licence", async () => {
    const calls: AppendInput[] = [];
    const asked: (readonly string[])[] = [];
    const hits = await runKnowledgeSearch(
      scope,
      { query: "fibre", k: 5 },
      ports(calls, {
        search: async (_embedding, _k, sources) => {
          asked.push(sources);
          return [dietRow, hrvRow, sleepRow];
        },
      }),
      ["literature:diet"],
    );
    expect(asked).toEqual([["opentwin-knowledge", "literature:diet"]]);
    expect(hits).toEqual([
      {
        kind: "literature",
        id: "lit-diet-PMC0000002.1",
        specialty: "diet",
        title: "Synthetic diet article",
        journal: "J Synth Nutr",
        year: 2023,
        pmcid: "PMC0000002",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000002/",
        doi: "10.0000/synthetic",
        licence: "cc-by-nc-nd",
        licenceLabel: "CC BY-NC-ND",
        sectionHeading: "Results",
        passage: "Fibre intake was recorded for 12 weeks.",
        attribution:
          '"Synthetic diet article". J Synth Nutr, 2023. PMC0000002. CC BY-NC-ND. via PubMed Central (NLM).',
        quoting:
          "Quote only word for word from passage, with the attribution line next to the quote. Its CC BY-NC-ND licence allows no changes: quote it unchanged or not at all, never shortened, reworded or translated.",
        about:
          "Published article as reference material, not a statement about this person.",
      },
      {
        id: "opentwin-metric-glossary",
        title: "Metric glossary",
        file: "knowledge/opentwin/metric-glossary.md",
        sectionHeading: "Heart rate variability (HRV)",
        licence: "cc-by-4.0",
        passage: hrvRow.text,
      },
    ]);
    expect(calls.map((call) => [call.tool, call.rowCount])).toEqual([
      ["knowledge.knowledge_search", 2],
    ]);
    expect(drainKnowledgeTurn("turn-kn-1").sources.map(({ id }) => id)).toEqual([
      "opentwin-metric-glossary",
    ]);
    expect(drainLiteratureTurn("turn-kn-1").sources).toEqual([
      {
        tool: "knowledge.knowledge_search",
        id: "lit-diet-PMC0000002.1",
        title: "Synthetic diet article",
        journal: "J Synth Nutr",
        year: 2023,
        pmcid: "PMC0000002",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000002/",
        doi: "10.0000/synthetic",
        licence: "cc-by-nc-nd",
        licenceLabel: "CC BY-NC-ND",
        sectionHeading: "Results",
      },
    ]);
  });
});
