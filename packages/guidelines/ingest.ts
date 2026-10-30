import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";

import { CATALOGUE_SECTION_HEADING, catalogueChunkText } from "./catalogue-chunk";
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
  /** The operator-extracted text, or null when this machine has none for the id. */
  readonly readText: (id: string) => Promise<string | null>;
  readonly embedDocuments: (texts: readonly string[]) => Promise<(number[] | null)[]>;
  readonly upsertDocument: typeof upsertGuidelineDocument;
  readonly replaceChunks: typeof replaceGuidelineChunks;
};

export type IngestResult = {
  readonly id: string;
  readonly ingestMode: "full_text" | "cite_only";
  readonly chunks: number;
  /** An open title whose text this machine lacks: catalogue only (#272). */
  readonly textMissing?: true;
};

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const defaultReadText = async (id: string): Promise<string | null> => {
  const root = join(process.cwd(), "data", "guidelines", id, "text.txt");
  try {
    return await readFile(root, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
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

/** One chunk holding the catalogue fields only, so `guideline_search` can find the title. */
const catalogueChunks = async (
  entry: GuidelineManifestEntry,
  ports: IngestPorts,
): Promise<StoredChunk[]> => {
  const text = catalogueChunkText(entry);
  const [embedding] = await ports.embedDocuments([text]);
  if (!embedding || embedding.length !== EMBEDDING_DIM) return [];
  return [
    {
      id: `${entry.id}-catalogue`,
      sectionHeading: CATALOGUE_SECTION_HEADING,
      recommendationId: null,
      recClass: null,
      evidenceLevel: null,
      page: null,
      text,
      embedding,
    },
  ];
};

const ingestCatalogueOnly = async (
  entry: GuidelineManifestEntry,
  ports: IngestPorts,
  textMissing: boolean,
): Promise<IngestResult> => {
  const db = ports.database();
  await ports.upsertDocument(db, { ...entry, ingestMode: "cite_only" });
  const chunks = await catalogueChunks(entry, ports);
  await ports.replaceChunks(db, entry.id, chunks);
  return {
    id: entry.id,
    ingestMode: "cite_only",
    chunks: chunks.length,
    ...(textMissing ? { textMissing: true as const } : {}),
  };
};

/**
 * A cite-only title, and an open title whose text is not on this machine, is
 * stored as `cite_only` with one catalogue chunk: searchable by its title,
 * never with a passage.
 */
export const ingestGuideline = async (
  entry: GuidelineManifestEntry,
  ports: IngestPorts,
): Promise<IngestResult> => {
  assertIngestAllowed(entry);
  if (entry.ingestMode === "cite_only") return ingestCatalogueOnly(entry, ports, false);
  const source = await ports.readText(entry.id);
  if (source === null) return ingestCatalogueOnly(entry, ports, true);
  const db = ports.database();
  await ports.upsertDocument(db, entry);
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
