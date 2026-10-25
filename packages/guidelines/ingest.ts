import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";

import { chunkGuidelineText, type GuidelineChunkDraft } from "./chunk";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "./constants";
import { defaultEmbedPorts, embedText, type EmbedPorts } from "./embed";
import { assertIngestAllowed } from "./licence";
import { GUIDELINE_MANIFEST, type GuidelineManifestEntry } from "./manifest";
import {
  replaceGuidelineChunks,
  upsertGuidelineDocument,
  type StoredChunk,
} from "./store";

export type IngestPorts = {
  readonly database: () => PrismaClient;
  readonly readText: (id: string) => Promise<string>;
  readonly embedDocuments: (texts: readonly string[]) => Promise<(number[] | null)[]>;
  readonly upsertDocument: typeof upsertGuidelineDocument;
  readonly replaceChunks: typeof replaceGuidelineChunks;
};

export type IngestResult = {
  readonly id: string;
  readonly ingestMode: "full_text" | "cite_only";
  readonly chunks: number;
};

const defaultReadText = async (id: string): Promise<string> => {
  const root = join(process.cwd(), "data", "guidelines", id, "text.txt");
  return readFile(root, "utf8");
};

export const defaultIngestPorts = (embedPorts?: EmbedPorts): IngestPorts => ({
  database,
  readText: defaultReadText,
  embedDocuments: async (texts) => {
    const ports = embedPorts ?? defaultEmbedPorts();
    const vectors: Array<number[] | null> = [];
    for (const text of texts) {
      vectors.push(await embedText(text, "document", ports));
    }
    return vectors;
  },
  upsertDocument: upsertGuidelineDocument,
  replaceChunks: replaceGuidelineChunks,
});

const toStored = (
  drafts: readonly GuidelineChunkDraft[],
  vectors: readonly (number[] | null)[],
): StoredChunk[] =>
  drafts.flatMap((draft, index) => {
    const embedding = vectors[index];
    if (!embedding || embedding.length !== EMBEDDING_DIM) return [];
    return [
      {
        id: `${draft.sectionHeading}-${index}`.replace(/\s+/g, "-").slice(0, 80),
        sectionHeading: draft.sectionHeading,
        recommendationId: draft.recommendationId,
        recClass: draft.recClass,
        evidenceLevel: draft.evidenceLevel,
        page: draft.page,
        text: draft.text,
        embedding,
      },
    ];
  });

export const ingestGuideline = async (
  entry: GuidelineManifestEntry,
  ports: IngestPorts,
): Promise<IngestResult> => {
  assertIngestAllowed(entry);
  const db = ports.database();
  await ports.upsertDocument(db, entry);
  if (entry.ingestMode === "cite_only") {
    await ports.replaceChunks(db, entry.id, []);
    return { id: entry.id, ingestMode: "cite_only", chunks: 0 };
  }
  const source = await ports.readText(entry.id);
  const drafts = chunkGuidelineText(source);
  const vectors = await ports.embedDocuments(drafts.map((draft) => draft.text));
  const chunks = toStored(drafts, vectors).map((chunk, index) => ({
    ...chunk,
    id: `${entry.id}-${index + 1}`,
  }));
  await ports.replaceChunks(db, entry.id, chunks);
  return { id: entry.id, ingestMode: "full_text", chunks: chunks.length };
};

export const ingestManifest = async (
  ports: IngestPorts,
  entries: readonly GuidelineManifestEntry[] = GUIDELINE_MANIFEST,
): Promise<readonly IngestResult[]> => {
  const results: IngestResult[] = [];
  for (const entry of entries) {
    results.push(await ingestGuideline(entry, ports));
  }
  return results;
};

export const embeddingContract = {
  model: EMBEDDING_MODEL,
  dim: EMBEDDING_DIM,
} as const;
