import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";
import { EMBEDDING_DIM } from "@/packages/guidelines/constants";
import {
  defaultEmbedPorts,
  embedText,
  type EmbedPorts,
} from "@/packages/guidelines/embed";
import {
  replaceGuidelineChunks,
  upsertGuidelineDocument,
  type StoredChunk,
} from "@/packages/guidelines/store";

import {
  chunkKnowledgeDocument,
  readKnowledgeCorpus,
  type KnowledgeDocument,
} from "./corpus";
import { fileCorpusPorts } from "./fs-corpus";
import { pruneKnowledgeDocuments } from "./store";

export type KnowledgeIngestPorts = {
  readonly database: () => PrismaClient;
  readonly readCorpus: () => Promise<readonly KnowledgeDocument[]>;
  readonly embedDocuments: (texts: readonly string[]) => Promise<(number[] | null)[]>;
  readonly upsertDocument: typeof upsertGuidelineDocument;
  readonly replaceChunks: typeof replaceGuidelineChunks;
  readonly pruneDocuments: typeof pruneKnowledgeDocuments;
};

export type KnowledgeIngestResult = {
  readonly documents: readonly { readonly id: string; readonly chunks: number }[];
  readonly pruned: number;
};

export const defaultKnowledgeIngestPorts = (
  embedPorts?: EmbedPorts,
): KnowledgeIngestPorts => ({
  database,
  readCorpus: () => readKnowledgeCorpus(fileCorpusPorts()),
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
  pruneDocuments: pruneKnowledgeDocuments,
});

/**
 * Embeds every chunk before writing anything for that file, so a failed
 * embedding stops the run instead of storing a partial file. Chunk ids are
 * `<document id>-<n>`, so a second run writes the same rows.
 */
const toStoredChunks = async (
  document: KnowledgeDocument,
  ports: KnowledgeIngestPorts,
): Promise<StoredChunk[]> => {
  const drafts = chunkKnowledgeDocument(document);
  const vectors = await ports.embedDocuments(drafts.map((draft) => draft.text));
  return drafts.map((draft, index) => {
    const embedding = vectors[index];
    if (!embedding || embedding.length !== EMBEDDING_DIM) {
      throw new Error(`KNOWLEDGE_EMBED_FAILED: ${document.id}`);
    }
    return {
      id: `${document.id}-${index + 1}`,
      sectionHeading: draft.sectionHeading,
      recommendationId: null,
      recClass: null,
      evidenceLevel: null,
      page: null,
      text: draft.text,
      embedding,
    };
  });
};

export const ingestKnowledge = async (
  ports: KnowledgeIngestPorts,
): Promise<KnowledgeIngestResult> => {
  const corpus = await ports.readCorpus();
  const db = ports.database();
  const documents: { id: string; chunks: number }[] = [];
  for (const document of corpus) {
    const chunks = await toStoredChunks(document, ports);
    await ports.upsertDocument(db, document);
    await ports.replaceChunks(db, document.id, chunks);
    documents.push({ id: document.id, chunks: chunks.length });
  }
  const pruned = await ports.pruneDocuments(
    db,
    corpus.map((document) => document.id),
  );
  return { documents, pruned };
};
