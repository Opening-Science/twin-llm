import { describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";

import { catalogueChunkText } from "./catalogue-chunk";
import { EMBEDDING_DIM } from "./constants";
import { ingestGuideline } from "./ingest";
import { GuidelineLicenceError } from "./licence";
import { GUIDELINE_MANIFEST } from "./manifest";
import type { StoredChunk } from "./store";

const byId = (id: string) => {
  const entry = GUIDELINE_MANIFEST.find((row) => row.id === id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
};

const fakeDb = {} as PrismaClient;

describe("guideline ingest", () => {
  test("cite_only writes metadata and one catalogue chunk, never body text", async () => {
    const vector = Array.from({ length: EMBEDDING_DIM }, () => 0.1);
    const chunks: StoredChunk[][] = [];
    const docs: Array<readonly [string, string]> = [];
    const embedded: string[] = [];
    const result = await ingestGuideline(byId("esc-pe-2019"), {
      database: () => fakeDb,
      readText: async () => {
        throw new Error("cite_only must not read body text");
      },
      embedDocuments: async (texts) => {
        embedded.push(...texts);
        return texts.map(() => vector);
      },
      upsertDocument: async (_db, entry) => {
        docs.push([entry.id, entry.ingestMode]);
      },
      replaceChunks: async (_db, _id, rows) => {
        chunks.push([...rows]);
      },
    });
    expect(result).toEqual({ id: "esc-pe-2019", ingestMode: "cite_only", chunks: 1 });
    expect(docs).toEqual([["esc-pe-2019", "cite_only"]]);
    expect(embedded).toEqual([catalogueChunkText(byId("esc-pe-2019"))]);
    expect(
      chunks[0]?.map((chunk) => [chunk.id, chunk.sectionHeading, chunk.text]),
    ).toEqual([
      [
        "esc-pe-2019-catalogue",
        "Catalogue entry",
        catalogueChunkText(byId("esc-pe-2019")),
      ],
    ]);
  });

  test("an open title with no local text is stored as catalogue only", async () => {
    const vector = Array.from({ length: EMBEDDING_DIM }, () => 0.1);
    const docs: Array<readonly [string, string]> = [];
    const stored: StoredChunk[] = [];
    const result = await ingestGuideline(byId("ean-als-2024"), {
      database: () => fakeDb,
      readText: async () => null,
      embedDocuments: async (texts) => texts.map(() => vector),
      upsertDocument: async (_db, entry) => {
        docs.push([entry.id, entry.ingestMode]);
      },
      replaceChunks: async (_db, _id, rows) => {
        stored.push(...rows);
      },
    });
    expect(result).toEqual({
      id: "ean-als-2024",
      ingestMode: "cite_only",
      chunks: 1,
      textMissing: true,
    });
    expect(docs).toEqual([["ean-als-2024", "cite_only"]]);
    expect(stored.map((chunk) => chunk.text)).toEqual([
      catalogueChunkText(byId("ean-als-2024")),
    ]);
  });

  test("a failed catalogue embed stores no chunk", async () => {
    const result = await ingestGuideline(byId("esc-svt-2019"), {
      database: () => fakeDb,
      readText: async () => null,
      embedDocuments: async (texts) => texts.map(() => null),
      upsertDocument: async () => undefined,
      replaceChunks: async () => undefined,
    });
    expect(result).toEqual({ id: "esc-svt-2019", ingestMode: "cite_only", chunks: 0 });
  });

  test("full_text ingest throws for every cite_only id", async () => {
    const citeOnly = GUIDELINE_MANIFEST.filter((row) => row.ingestMode === "cite_only");
    expect(citeOnly.length).toBe(5);
    for (const entry of citeOnly) {
      await expect(
        ingestGuideline(
          { ...entry, ingestMode: "full_text" },
          {
            database: () => fakeDb,
            readText: async () => {
              throw new Error("must not read after licence refuse");
            },
            embedDocuments: async () => {
              throw new Error("must not embed after licence refuse");
            },
            upsertDocument: async () => {
              throw new Error("must not write after licence refuse");
            },
            replaceChunks: async () => {
              throw new Error("must not write chunks after licence refuse");
            },
          },
        ),
      ).rejects.toBeInstanceOf(GuidelineLicenceError);
    }
  });

  test("every cite_only id embeds only its catalogue text", async () => {
    const citeOnly = GUIDELINE_MANIFEST.filter((row) => row.ingestMode === "cite_only");
    expect(citeOnly.length).toBe(5);
    for (const entry of citeOnly) {
      const embedded: string[] = [];
      const result = await ingestGuideline(entry, {
        database: () => fakeDb,
        readText: async () => {
          throw new Error(`${entry.id} must not read body text`);
        },
        embedDocuments: async (texts) => {
          embedded.push(...texts);
          return texts.map(() => Array.from({ length: EMBEDDING_DIM }, () => 0.1));
        },
        upsertDocument: async () => undefined,
        replaceChunks: async () => undefined,
      });
      expect(result).toEqual({ id: entry.id, ingestMode: "cite_only", chunks: 1 });
      expect(embedded).toEqual([catalogueChunkText(entry)]);
    }
  });

  test("full_text chunks use local embeddings only", async () => {
    const vector = Array.from({ length: EMBEDDING_DIM }, () => 0.1);
    const stored: StoredChunk[] = [];
    const result = await ingestGuideline(byId("ean-als-2024"), {
      database: () => fakeDb,
      readText: async () =>
        [
          "# Section: Non-invasive ventilation",
          "# Rec: R3",
          "# Class: Strong",
          "# Evidence: moderate",
          "",
          "NIV is named in the published section.",
        ].join("\n"),
      embedDocuments: async (texts) => texts.map(() => vector),
      upsertDocument: async () => undefined,
      replaceChunks: async (_db, _id, rows) => {
        stored.push(...rows);
      },
    });
    expect(result.chunks).toBe(1);
    expect(stored[0]?.text).toContain("Rec R3");
    expect(stored[0]?.recommendationId).toBe("R3");
    expect(stored[0]?.embedding).toHaveLength(EMBEDDING_DIM);
  });
});
