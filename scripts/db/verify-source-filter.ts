/**
 * db:verify probe for the source filter on guideline_chunks.
 *
 * Loads 5000 synthetic guideline chunks that sit closer to the query than 3
 * synthetic knowledge chunks. At that size the planner uses the HNSW index
 * (checked with EXPLAIN, so the probe cannot pass on a seq scan). A plain
 * HNSW scan stops after ef_search candidates, all guideline rows, and the
 * knowledge filter would come back empty; `queryNearestChunks` must still
 * return the 3 knowledge chunks, and guideline rows for the guideline source.
 * Every probe row is removed again. Vectors only, no text from any corpus.
 *
 * Run (from verify-migrations.sh):
 *   bun --preload ./features/chat/response/preload-server-only.mjs scripts/db/verify-source-filter.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { queryNearestChunks } from "@/packages/guidelines/search";

const GUIDELINE_CHUNKS = 5000;
const KNOWLEDGE_IDS = ["verify-sf-kn-1", "verify-sf-kn-2", "verify-sf-kn-3"];
const QUERY = [1, ...Array.from({ length: 767 }, () => 0)];
const QUERY_SQL = `('[1' || repeat(',0', 767) || ']')::vector`;

const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("verify-source-filter FAIL: DATABASE_URL is required");
    process.exit(1);
  }
  return url;
};

const fail = (message: string): never => {
  throw new Error(`verify-source-filter FAIL: ${message}`);
};

/** 768-d vector literal in SQL: `first` at dim 1, `second` at dim 2, small noise elsewhere. */
const vectorExpr = (first: number, second: number): string =>
  `('[' || array_to_string(array(SELECT CASE WHEN i = 1 THEN ${first} WHEN i = 2 THEN ${second} ` +
  `ELSE random() * 0.05 END FROM generate_series(1, 768) i WHERE n > 0), ',') || ']')::vector`;

const cleanup = (client: PrismaClient) =>
  client.$executeRawUnsafe(
    `DELETE FROM guideline_documents WHERE id IN ('verify-sf-guideline', 'verify-sf-knowledge')`,
  );

const seed = async (client: PrismaClient): Promise<void> => {
  await client.$executeRawUnsafe(`
    INSERT INTO guideline_documents
      (id, title, year, society, doi, url, licence, ingest_mode, embedding_model, embedding_dim, source)
    VALUES
      ('verify-sf-guideline', 'probe', 2026, 'probe', '', 'probe', 'esc-oup', 'full_text', 'nomic-embed-text', 768, 'guideline'),
      ('verify-sf-knowledge', 'probe', 2026, 'probe', '', 'probe', 'cc-by-4.0', 'full_text', 'nomic-embed-text', 768, 'opentwin-knowledge')`);
  await client.$executeRawUnsafe(`
    INSERT INTO guideline_chunks (id, document_id, section_heading, text, embedding)
    SELECT 'verify-sf-gl-' || n, 'verify-sf-guideline', 'probe', 'probe', ${vectorExpr(1, 0)}
    FROM generate_series(1, ${GUIDELINE_CHUNKS}) n`);
  await client.$executeRawUnsafe(`
    INSERT INTO guideline_chunks (id, document_id, section_heading, text, embedding)
    SELECT 'verify-sf-kn-' || n, 'verify-sf-knowledge', 'probe', 'probe', ${vectorExpr(0.3, 1)}
    FROM generate_series(1, 3) n`);
  await client.$executeRawUnsafe(`ANALYZE guideline_chunks`);
  await client.$executeRawUnsafe(`ANALYZE guideline_documents`);
};

const assertPgvectorVersion = async (client: PrismaClient): Promise<string> => {
  const [row] = await client.$queryRawUnsafe<{ extversion: string }[]>(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  const version = row?.extversion ?? fail("vector extension missing");
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (major === 0 && minor < 8)
    fail(`pgvector ${version} has no iterative scan (needs 0.8+)`);
  return version;
};

const plainKnowledgeQuery = `
  SELECT c.id FROM guideline_chunks c
  INNER JOIN guideline_documents d ON d.id = c.document_id
  WHERE d.source = 'opentwin-knowledge'
  ORDER BY c.embedding <=> ${QUERY_SQL}
  LIMIT 3`;

const main = async (): Promise<void> => {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl() }),
  });
  try {
    const version = await assertPgvectorVersion(client);
    await cleanup(client);
    await seed(client);

    const plan = await client.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN (COSTS OFF) ${plainKnowledgeQuery}`,
    );
    if (
      !plan.some((line) => line["QUERY PLAN"].includes("guideline_chunks_embedding_hnsw"))
    ) {
      fail("planner did not use the HNSW index, so this probe proves nothing");
    }
    const plain = await client.$queryRawUnsafe<{ id: string }[]>(plainKnowledgeQuery);

    const knowledge = await queryNearestChunks(client, QUERY, 3, "opentwin-knowledge");
    const knowledgeIds = knowledge.map((row) => row.id).sort();
    if (JSON.stringify(knowledgeIds) !== JSON.stringify(KNOWLEDGE_IDS)) {
      fail(`knowledge source returned ${JSON.stringify(knowledgeIds)}`);
    }
    const guideline = await queryNearestChunks(client, QUERY, 3, "guideline");
    if (
      guideline.length !== 3 ||
      guideline.some((row) => row.documentId !== "verify-sf-guideline")
    ) {
      fail(`guideline source returned ${JSON.stringify(guideline.map((row) => row.id))}`);
    }

    console.warn(
      `verify-source-filter OK: pgvector ${version}, HNSW plan, plain scan ${plain.length}/3 knowledge rows, ` +
        `queryNearestChunks 3/3 knowledge rows and 3 guideline rows over ${GUIDELINE_CHUNKS} guideline chunks`,
    );
  } finally {
    await cleanup(client);
    await client.$disconnect();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "verify-source-filter FAIL");
  process.exit(1);
});
