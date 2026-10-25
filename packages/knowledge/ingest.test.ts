import { describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import { EMBEDDING_DIM } from "@/packages/guidelines/constants";
import type { StoredChunk, StoredDocument } from "@/packages/guidelines/store";

import { parseKnowledgeFile } from "./corpus";
import { ingestKnowledge, type KnowledgeIngestPorts } from "./ingest";

const fakeDb = {} as PrismaClient;
const vector = Array.from({ length: EMBEDDING_DIM }, () => 0.1);

const NOTE = parseKnowledgeFile(
  "sample-note.md",
  [
    "# Title: Sample note",
    "# Section: First part",
    "First body.",
    "# Section: Second part",
    "Second body.",
  ].join("\n"),
);

type Writes = {
  documents: StoredDocument[];
  chunks: Array<[string, StoredChunk[]]>;
  keep: string[][];
};

const recordingPorts = (
  writes: Writes,
  overrides: Partial<KnowledgeIngestPorts> = {},
): KnowledgeIngestPorts => ({
  database: () => fakeDb,
  readCorpus: async () => [NOTE],
  embedDocuments: async (texts) => texts.map(() => vector),
  upsertDocument: async (_db, document) => {
    writes.documents.push(document);
  },
  replaceChunks: async (_db, id, rows) => {
    writes.chunks.push([id, [...rows]]);
  },
  pruneDocuments: async (_db, keepIds) => {
    writes.keep.push([...keepIds]);
    return 0;
  },
  ...overrides,
});

const emptyWrites = (): Writes => ({ documents: [], chunks: [], keep: [] });

describe("ingestKnowledge", () => {
  test("writes the document with source opentwin-knowledge and one chunk per section", async () => {
    const writes = emptyWrites();
    const result = await ingestKnowledge(recordingPorts(writes));
    expect(result).toEqual({
      documents: [{ id: "opentwin-sample-note", chunks: 2 }],
      pruned: 0,
    });
    expect(
      writes.documents.map((document) => [
        document.id,
        document.source,
        document.licence,
      ]),
    ).toEqual([["opentwin-sample-note", "opentwin-knowledge", "cc-by-4.0"]]);
    expect(
      writes.chunks.map(([id, rows]) => [
        id,
        rows.map((row) => [row.id, row.sectionHeading, row.page]),
      ]),
    ).toEqual([
      [
        "opentwin-sample-note",
        [
          ["opentwin-sample-note-1", "First part", null],
          ["opentwin-sample-note-2", "Second part", null],
        ],
      ],
    ]);
    expect(writes.keep).toEqual([["opentwin-sample-note"]]);
  });

  test("a second run writes exactly the same rows", async () => {
    const first = emptyWrites();
    const second = emptyWrites();
    await ingestKnowledge(recordingPorts(first));
    await ingestKnowledge(recordingPorts(second));
    expect(second).toEqual(first);
  });

  test("files that are gone are pruned and counted", async () => {
    const writes = emptyWrites();
    const result = await ingestKnowledge(
      recordingPorts(writes, {
        readCorpus: async () => [],
        pruneDocuments: async (_db, keepIds) => {
          writes.keep.push([...keepIds]);
          return 2;
        },
      }),
    );
    expect(result).toEqual({ documents: [], pruned: 2 });
    expect(writes.keep).toEqual([[]]);
  });

  test("a failed embedding stops the run before that file is written", async () => {
    const writes = emptyWrites();
    await expect(
      ingestKnowledge(
        recordingPorts(writes, {
          embedDocuments: async (texts) => texts.map(() => null),
        }),
      ),
    ).rejects.toThrow("KNOWLEDGE_EMBED_FAILED: opentwin-sample-note");
    expect(writes).toEqual(emptyWrites());
  });
});
