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
  type StoredChunk,
  upsertGuidelineDocument,
} from "@/packages/guidelines/store";

import { chunkLiteratureArticle, toLiteratureDocument } from "./article";
import { type LiteratureArticle, readLiteratureCorpus } from "./corpus";
import { fileLiteraturePorts } from "./fs-corpus";
import { isLiteratureLicence } from "./licence";
import { literatureSource, SPECIALTY_IDS, type SpecialtyId } from "./specialties";
import { pruneLiteratureDocuments } from "./store";

export type LiteratureIngestPorts = Readonly<{
  database: () => PrismaClient;
  readCorpus: (
    specialties: readonly SpecialtyId[],
  ) => Promise<readonly LiteratureArticle[]>;
  embedDocuments: (texts: readonly string[]) => Promise<(number[] | null)[]>;
  upsertDocument: typeof upsertGuidelineDocument;
  replaceChunks: typeof replaceGuidelineChunks;
  pruneDocuments: typeof pruneLiteratureDocuments;
}>;

export type LiteratureIngestResult = Readonly<{
  documents: readonly Readonly<{ id: string; source: string; chunks: number }>[];
  pruned: number;
}>;

export const defaultLiteratureIngestPorts = (
  embedPorts?: EmbedPorts,
): LiteratureIngestPorts => ({
  database,
  readCorpus: (specialties) => readLiteratureCorpus(fileLiteraturePorts(), specialties),
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
  pruneDocuments: pruneLiteratureDocuments,
});

/** Embeds every chunk of an article before anything is written for it. */
const toStoredChunks = async (
  article: LiteratureArticle,
  documentId: string,
  ports: LiteratureIngestPorts,
): Promise<StoredChunk[]> => {
  const drafts = chunkLiteratureArticle(article.record, article.text);
  const vectors = await ports.embedDocuments(drafts.map((draft) => draft.text));
  return drafts.map((draft, index) => {
    const embedding = vectors[index];
    if (!embedding || embedding.length !== EMBEDDING_DIM) {
      throw new Error(`LITERATURE_EMBED_FAILED: ${documentId}`);
    }
    return {
      id: `${documentId}-${index + 1}`,
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

/**
 * Embeds the fetched articles of the given specialties into the guideline
 * tables, one source per specialty (`literature:<specialty>`), so a search
 * can be limited to one agent's literature. The licence is checked again
 * here, so a hand-edited record cannot slip in. Articles whose files were
 * removed are pruned from those specialties only.
 */
export const ingestLiterature = async (
  ports: LiteratureIngestPorts,
  specialties: readonly SpecialtyId[] = SPECIALTY_IDS,
): Promise<LiteratureIngestResult> => {
  const corpus = await ports.readCorpus(specialties);
  const db = ports.database();
  const documents: { id: string; source: string; chunks: number }[] = [];
  for (const article of corpus) {
    if (!isLiteratureLicence(article.record.licence)) {
      throw new Error(`LITERATURE_LICENCE_REFUSED: ${article.record.pmcid}`);
    }
    const document = toLiteratureDocument(article.record);
    const chunks = await toStoredChunks(article, document.id, ports);
    if (chunks.length === 0) continue;
    await ports.upsertDocument(db, document);
    await ports.replaceChunks(db, document.id, chunks);
    documents.push({
      id: document.id,
      source: document.source ?? "",
      chunks: chunks.length,
    });
  }
  const pruned = await ports.pruneDocuments(
    db,
    specialties.map(literatureSource),
    documents.map((document) => document.id),
  );
  return { documents, pruned };
};
