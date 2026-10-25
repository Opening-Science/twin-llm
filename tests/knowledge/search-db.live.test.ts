/**
 * Both corpora in one database. Needs a throwaway DATABASE_URL with
 * guideline ingest (200+ chunks) and `bun run knowledge:ingest` done, and
 * local Ollama with nomic-embed-text. Uses the same embed and SQL as the tools.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway> bun test --preload ./features/chat/response/preload-server-only.mjs tests/knowledge/search-db.live.test.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, test } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";
import {
  DEFAULT_OLLAMA_OPENAI_URL,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  GUIDELINE_SOURCE,
} from "@/packages/guidelines/constants";
import {
  embedText,
  ollamaNativeOrigin,
  type EmbedPorts,
} from "@/packages/guidelines/embed";
import { GUIDELINE_MANIFEST } from "@/packages/guidelines/manifest";
import { queryNearestChunks } from "@/packages/guidelines/search";
import { KNOWLEDGE_SOURCE } from "@/packages/knowledge/constants";

const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const databaseUrl = String(Reflect.get(process.env, "DATABASE_URL") ?? "");

const ports: EmbedPorts = {
  fetch,
  origin: ollamaNativeOrigin(DEFAULT_OLLAMA_OPENAI_URL),
  model: EMBEDDING_MODEL,
  dim: EMBEDDING_DIM,
  requireLoopback: true,
};

describe.skipIf(!runLive)(
  "knowledge and guideline search in one database (RUN_LIVE=1)",
  () => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });

    afterAll(async () => {
      await client.$disconnect();
    });

    const query = async (text: string, source: string) => {
      const vector = await embedText(text, "query", ports);
      if (!vector) throw new Error("query embedding failed: is Ollama running?");
      return queryNearestChunks(client, vector, 3, source);
    };

    test("both corpora are loaded, with 200+ guideline chunks", async () => {
      const counts = await client.$queryRawUnsafe<{ source: string; chunks: number }[]>(
        `SELECT d.source, count(c.id)::int AS chunks
       FROM guideline_documents d JOIN guideline_chunks c ON c.document_id = d.id
       GROUP BY d.source`,
      );
      const bySource = new Map(counts.map((row) => [row.source, row.chunks]));
      expect(bySource.get(GUIDELINE_SOURCE) ?? 0).toBeGreaterThanOrEqual(200);
      expect(bySource.get(KNOWLEDGE_SOURCE) ?? 0).toBeGreaterThan(0);
    });

    test('knowledge_search "what does HRV measure?" returns the glossary HRV section', async () => {
      const rows = await query("what does HRV measure?", KNOWLEDGE_SOURCE);
      expect(rows.map((row) => row.url)).toContain(
        "knowledge/opentwin/metric-glossary.md",
      );
      expect(rows.map((row) => row.sectionHeading)).toContain(
        "Heart rate variability (HRV)",
      );
      expect(rows.every((row) => row.documentId.startsWith("opentwin-"))).toBe(true);
    });

    test("guideline_search returns guideline rows only", async () => {
      const guidelineIds = new Set(GUIDELINE_MANIFEST.map((entry) => entry.id));
      const rows = await query(
        "non-invasive ventilation in amyotrophic lateral sclerosis",
        GUIDELINE_SOURCE,
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => guidelineIds.has(row.documentId))).toBe(true);
    });
  },
);
