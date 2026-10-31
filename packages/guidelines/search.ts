import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { append } from "@/packages/audit/append";
import type { SessionScope } from "@/packages/query-tools/scope";

import { recordGuidelineTurn, type GuidelineCitation } from "./collector";
import { GUIDELINE_AUDIT_TOOL, GUIDELINE_SOURCE } from "./constants";
import { defaultEmbedPorts, embedText, type EmbedPorts, queryEmbedPorts } from "./embed";
import type { GuidelineSearchInput } from "./input";

export type GuidelineJoinedRow = {
  readonly id: string;
  readonly sectionHeading: string;
  readonly recommendationId: string | null;
  readonly recClass: string | null;
  readonly evidenceLevel: string | null;
  readonly page: string | null;
  readonly text: string;
  readonly documentId: string;
  readonly title: string;
  readonly year: number;
  readonly society: string;
  readonly doi: string;
  readonly url: string;
  readonly licence: string;
  readonly ingestMode: string;
  /** `guideline_documents.source`: `guideline`, `opentwin-knowledge`, `literature:<id>`. */
  readonly source: string;
};

export type GuidelineHit = {
  readonly id: string;
  readonly title: string;
  readonly year: number;
  readonly society: string;
  readonly doi: string;
  readonly url: string;
  readonly licence: string;
  readonly ingestMode: string;
  readonly sectionHeading: string;
  readonly recommendationId: string | null;
  readonly recClass: string | null;
  readonly evidenceLevel: string | null;
  readonly page: string | null;
  readonly passage: string | null;
};

export type GuidelineSearchPorts = {
  readonly embed: (query: string, ports?: EmbedPorts) => Promise<number[] | null>;
  readonly search: (
    embedding: readonly number[],
    k: number,
  ) => Promise<readonly GuidelineJoinedRow[]>;
  readonly append: typeof append;
  readonly database: () => PrismaClient;
};

const vectorLiteral = (values: readonly number[]): string =>
  `[${values.map((value) => (Number.isFinite(value) ? String(value) : "0")).join(",")}]`;

const vectorSql = (values: readonly number[]): Prisma.Sql =>
  Prisma.raw(`'${vectorLiteral(values)}'::vector`);

/**
 * Nearest chunks of one source (`guideline`, `opentwin-knowledge`) or of
 * several (knowledge notes plus an agent's `literature:<specialty>` sources).
 *
 * The source filter is applied after the HNSW index scan. A plain HNSW scan
 * stops after `hnsw.ef_search` (40) candidates, so once the guideline corpus
 * is large enough for the planner to use the index, a small source could come
 * back short or empty. pgvector >= 0.8 iterative scan keeps scanning until k
 * rows pass the filter; `SET LOCAL` keeps the setting inside this transaction.
 * `relaxed_order` can return rows slightly out of order, so the outer query
 * sorts by distance again. `db:verify` checks the index path
 * (`scripts/db/verify-source-filter.ts`).
 */
export const queryNearestChunks = async (
  db: PrismaClient,
  embedding: readonly number[],
  k: number,
  source: string | readonly string[],
): Promise<GuidelineJoinedRow[]> => {
  const sources = typeof source === "string" ? [source] : [...source];
  if (sources.length === 0) return [];
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    return tx.$queryRaw<GuidelineJoinedRow[]>(Prisma.sql`
      WITH nearest AS MATERIALIZED (
        SELECT
          c.id,
          c.section_heading AS "sectionHeading",
          c.recommendation_id AS "recommendationId",
          c.rec_class AS "recClass",
          c.evidence_level AS "evidenceLevel",
          c.page,
          c.text,
          d.id AS "documentId",
          d.title,
          d.year,
          d.society,
          d.doi,
          d.url,
          d.licence,
          d.ingest_mode AS "ingestMode",
          d.source,
          c.embedding <=> ${vectorSql(embedding)} AS distance
        FROM guideline_chunks c
        INNER JOIN guideline_documents d ON d.id = c.document_id
        WHERE d.source IN (${Prisma.join(sources)})
        ORDER BY c.embedding <=> ${vectorSql(embedding)}
        LIMIT ${k}
      )
      SELECT
        id, "sectionHeading", "recommendationId", "recClass", "evidenceLevel",
        page, text, "documentId", title, year, society, doi, url, licence, "ingestMode",
        source
      FROM nearest
      ORDER BY distance
    `);
  });
};

export const toGuidelineHit = (row: GuidelineJoinedRow): GuidelineHit => ({
  id: row.documentId,
  title: row.title,
  year: row.year,
  society: row.society,
  doi: row.doi,
  url: row.url,
  licence: row.licence,
  ingestMode: row.ingestMode,
  sectionHeading: row.sectionHeading,
  recommendationId: row.recommendationId,
  recClass: row.recClass,
  evidenceLevel: row.evidenceLevel,
  page: row.page,
  passage: row.ingestMode === "cite_only" ? null : row.text,
});

export const toGuidelineCitation = (hit: GuidelineHit): GuidelineCitation => ({
  tool: GUIDELINE_AUDIT_TOOL,
  id: hit.id,
  title: hit.title,
  year: hit.year,
  society: hit.society,
  doi: hit.doi,
  url: hit.url,
  licence: hit.licence,
  ingestMode: hit.ingestMode,
  sectionHeading: hit.sectionHeading,
  recommendationId: hit.recommendationId,
  recClass: hit.recClass,
  evidenceLevel: hit.evidenceLevel,
  page: hit.page,
});

/** The query embedding goes through the disclosure ledger when Ollama is elsewhere (#140). */
export const defaultGuidelineSearchPorts = (
  scope: SessionScope,
): GuidelineSearchPorts => ({
  embed: (query) =>
    embedText(
      query,
      "query",
      queryEmbedPorts(defaultEmbedPorts(), {
        actor: scope.actor,
        sessionId: scope.sessionId,
        synthetic: scope.mode === "synthetic",
        purpose: "guideline search",
        record: recordDisclosure,
      }),
    ),
  search: (embedding, k) =>
    queryNearestChunks(database(), embedding, k, GUIDELINE_SOURCE),
  append,
  database,
});

const errorResult = (error: unknown): { readonly error: string } => ({
  error: error instanceof Error ? error.message : "guideline-search-failed",
});

export const runGuidelineSearch = async (
  scope: SessionScope,
  input: GuidelineSearchInput,
  ports: GuidelineSearchPorts = defaultGuidelineSearchPorts(scope),
): Promise<GuidelineHit[]> => {
  let hits: GuidelineHit[] = [];
  let result: unknown = [];
  try {
    const embedding = await ports.embed(input.query);
    if (!embedding) {
      result = { error: "guideline-embed-failed" };
    } else {
      hits = (await ports.search(embedding, input.k)).map(toGuidelineHit);
      result = hits;
    }
  } catch (error) {
    hits = [];
    result = errorResult(error);
  }

  await ports.append(ports.database(), {
    actor: scope.actor,
    sessionId: scope.sessionId,
    subjectRef: null,
    tool: GUIDELINE_AUDIT_TOOL,
    args: input,
    result,
    rowCount: hits.length,
  });
  recordGuidelineTurn(scope.sessionId, hits.map(toGuidelineCitation));
  return hits;
};
