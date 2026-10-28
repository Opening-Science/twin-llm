import { describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import { EMBEDDING_DIM } from "@/packages/guidelines/constants";
import type { StoredChunk, StoredDocument } from "@/packages/guidelines/store";

import { toLiteratureRecord } from "./article";
import type { LiteratureArticle } from "./corpus";
import { fixture } from "./fixture";
import { ingestLiterature, type LiteratureIngestPorts } from "./ingest";
import { parsePmcMetadata } from "./pmc";

const fakeDb = {} as PrismaClient;
const vector = Array.from({ length: EMBEDDING_DIM }, () => 0.1);

const ARTICLE: LiteratureArticle = {
  record: toLiteratureRecord(parsePmcMetadata(fixture("metadata.json")), {
    specialty: "diet",
    licence: "cc-by",
    query: "q",
    fetchedAt: "2026-10-28T00:00:00.000Z",
  }),
  text: fixture("article.txt"),
};

type Writes = {
  documents: StoredDocument[];
  chunks: Array<[string, StoredChunk[]]>;
  prunes: Array<[string[], string[]]>;
  read: string[][];
};

const recordingPorts = (
  writes: Writes,
  overrides: Partial<LiteratureIngestPorts> = {},
): LiteratureIngestPorts => ({
  database: () => fakeDb,
  readCorpus: async (specialties) => {
    writes.read.push([...specialties]);
    return [ARTICLE];
  },
  embedDocuments: async (texts) => texts.map(() => vector),
  upsertDocument: async (_db, document) => {
    writes.documents.push(document);
  },
  replaceChunks: async (_db, id, rows) => {
    writes.chunks.push([id, [...rows]]);
  },
  pruneDocuments: async (_db, sources, keep) => {
    writes.prunes.push([[...sources], [...keep]]);
    return 1;
  },
  ...overrides,
});

const empty = (): Writes => ({ documents: [], chunks: [], prunes: [], read: [] });

describe("ingestLiterature", () => {
  test("writes one document tagged with its specialty and one chunk per section", async () => {
    const writes = empty();
    const result = await ingestLiterature(recordingPorts(writes), ["diet"]);
    expect(result).toEqual({
      documents: [{ id: "lit-diet-PMC1000001.2", source: "literature:diet", chunks: 4 }],
      pruned: 1,
    });
    expect(writes.read).toEqual([["diet"]]);
    expect(writes.documents.map((document) => document.source)).toEqual([
      "literature:diet",
    ]);
    expect(writes.chunks[0]?.[1].map((chunk) => chunk.id)).toEqual([
      "lit-diet-PMC1000001.2-1",
      "lit-diet-PMC1000001.2-2",
      "lit-diet-PMC1000001.2-3",
      "lit-diet-PMC1000001.2-4",
    ]);
    expect(writes.prunes).toEqual([[["literature:diet"], ["lit-diet-PMC1000001.2"]]]);
  });

  test("prunes every specialty's source when none is given", async () => {
    const writes = empty();
    await ingestLiterature(recordingPorts(writes));
    expect(writes.prunes[0]?.[0]).toEqual([
      "literature:gp",
      "literature:diet",
      "literature:anatomy",
      "literature:sleep",
      "literature:trainer",
      "literature:genetics",
    ]);
  });

  test("an article with no usable body is not written", async () => {
    const writes = empty();
    const result = await ingestLiterature(
      recordingPorts(writes, {
        readCorpus: async () => [
          { ...ARTICLE, text: "INFO\n==========\nonly front matter" },
        ],
      }),
      ["diet"],
    );
    expect(result).toEqual({ documents: [], pruned: 1 });
    expect(writes.documents).toEqual([]);
    expect(writes.prunes).toEqual([[["literature:diet"], []]]);
  });

  test("a failed embedding stops before anything is written for the article", async () => {
    const writes = empty();
    await expect(
      ingestLiterature(
        recordingPorts(writes, {
          embedDocuments: async (texts) => texts.map(() => null),
        }),
        ["diet"],
      ),
    ).rejects.toThrow("LITERATURE_EMBED_FAILED: lit-diet-PMC1000001.2");
    expect(writes.documents).toEqual([]);
    expect(writes.chunks).toEqual([]);
    expect(writes.prunes).toEqual([]);
  });
});
