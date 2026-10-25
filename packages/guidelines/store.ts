import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";

import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  GUIDELINE_SOURCE,
  type IngestMode,
} from "./constants";

export type StoredChunk = {
  readonly id: string;
  readonly sectionHeading: string;
  readonly recommendationId: string | null;
  readonly recClass: string | null;
  readonly evidenceLevel: string | null;
  readonly page: string | null;
  readonly text: string;
  readonly embedding: readonly number[];
};

/** A guideline manifest entry or an OpenTwin knowledge file. */
export type StoredDocument = {
  readonly id: string;
  readonly title: string;
  readonly year: number;
  readonly society: string;
  readonly doi: string;
  readonly url: string;
  readonly licence: string;
  readonly ingestMode: IngestMode;
  /** Defaults to "guideline", so guideline ingest is unchanged. */
  readonly source?: string;
};

const vectorLiteral = (values: readonly number[]): string =>
  `[${values.map((value) => (Number.isFinite(value) ? String(value) : "0")).join(",")}]`;

const vectorSql = (values: readonly number[]): Prisma.Sql =>
  Prisma.raw(`'${vectorLiteral(values)}'::vector`);

export const upsertGuidelineDocument = async (
  db: PrismaClient,
  entry: StoredDocument,
): Promise<void> => {
  const source = entry.source ?? GUIDELINE_SOURCE;
  await db.guidelineDocument.upsert({
    where: { id: entry.id },
    create: {
      id: entry.id,
      title: entry.title,
      year: entry.year,
      society: entry.society,
      doi: entry.doi,
      url: entry.url,
      licence: entry.licence,
      ingestMode: entry.ingestMode,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDim: EMBEDDING_DIM,
      source,
    },
    update: {
      title: entry.title,
      year: entry.year,
      society: entry.society,
      doi: entry.doi,
      url: entry.url,
      licence: entry.licence,
      ingestMode: entry.ingestMode,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDim: EMBEDDING_DIM,
      source,
    },
  });
};

export const replaceGuidelineChunks = async (
  db: PrismaClient,
  documentId: string,
  chunks: readonly StoredChunk[],
): Promise<void> => {
  await db.guidelineChunk.deleteMany({ where: { documentId } });
  for (const chunk of chunks) {
    if (chunk.embedding.length !== EMBEDDING_DIM) {
      throw new Error("GUIDELINE_EMBED_DIM_MISMATCH");
    }
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO "guideline_chunks" (
          "id", "document_id", "section_heading", "recommendation_id",
          "rec_class", "evidence_level", "page", "text", "embedding"
        ) VALUES (
          ${chunk.id},
          ${documentId},
          ${chunk.sectionHeading},
          ${chunk.recommendationId},
          ${chunk.recClass},
          ${chunk.evidenceLevel},
          ${chunk.page},
          ${chunk.text},
          ${vectorSql(chunk.embedding)}
        )
      `,
    );
  }
};
