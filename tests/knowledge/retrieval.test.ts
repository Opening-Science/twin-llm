/**
 * Retrieval check for the OpenTwin knowledge corpus (B4).
 *
 * Offline (always): every case points at a file and section that exist.
 * Live (RUN_LIVE=1, local Ollama with nomic-embed-text on 127.0.0.1:11434):
 * embeds every chunk and question the way ingest and knowledge_search do,
 * ranks by cosine (the metric behind pgvector `<=>`) and reports the top-3
 * hit rate. Run:
 *   RUN_LIVE=1 bun test --preload ./features/chat/response/preload-server-only.mjs tests/knowledge
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_OLLAMA_OPENAI_URL,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "@/packages/guidelines/constants";
import {
  embedText,
  ollamaNativeOrigin,
  type EmbedPorts,
} from "@/packages/guidelines/embed";
import { chunkKnowledgeDocument, readKnowledgeCorpus } from "@/packages/knowledge/corpus";
import { fileCorpusPorts } from "@/packages/knowledge/fs-corpus";

import cases from "./cases.json";

type Case = { id: string; question: string; file: string; section: string };

const TOP_K = 3;
const TARGET_HITS = 16;
const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";

const loadChunks = async () => {
  const corpus = await readKnowledgeCorpus(fileCorpusPorts());
  return corpus.flatMap((document) =>
    chunkKnowledgeDocument(document).map((draft) => ({
      file: document.file,
      section: draft.sectionHeading,
      text: draft.text,
    })),
  );
};

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return dot / Math.sqrt(normA * normB);
};

describe("knowledge retrieval cases", () => {
  test("20 cases, each pointing at an existing file and section", async () => {
    const chunks = await loadChunks();
    const known = new Set(chunks.map((chunk) => `${chunk.file}#${chunk.section}`));
    const list = cases as Case[];
    expect(list).toHaveLength(20);
    expect(new Set(list.map((item) => item.id)).size).toBe(20);
    expect(list.filter((item) => !known.has(`${item.file}#${item.section}`))).toEqual([]);
  });
});

describe.skipIf(!runLive)("knowledge retrieval live (RUN_LIVE=1)", () => {
  test(`top-${TOP_K} hit rate with local ${EMBEDDING_MODEL}`, async () => {
    const ports: EmbedPorts = {
      fetch,
      origin: ollamaNativeOrigin(DEFAULT_OLLAMA_OPENAI_URL),
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      requireLoopback: true,
    };
    const chunks = await loadChunks();
    const vectors: number[][] = [];
    for (const chunk of chunks) {
      const vector = await embedText(chunk.text, "document", ports);
      if (!vector)
        throw new Error("embedding failed: is Ollama running with nomic-embed-text?");
      vectors.push(vector);
    }
    const misses: string[] = [];
    for (const item of cases as Case[]) {
      const query = await embedText(item.question, "query", ports);
      if (!query) throw new Error("query embedding failed");
      const top = chunks
        .map((chunk, index) => ({ chunk, score: cosine(query, vectors[index]!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K);
      const hit = top.some(
        ({ chunk }) => chunk.file === item.file && chunk.section === item.section,
      );
      if (!hit) {
        misses.push(
          `${item.id}: got ${top.map(({ chunk }) => chunk.section).join(" | ")}`,
        );
      }
    }
    const hits = cases.length - misses.length;
    console.warn(
      `knowledge retrieval: top-${TOP_K} ${hits}/${cases.length} over ${chunks.length} chunks`,
    );
    for (const miss of misses) console.warn(`  miss ${miss}`);
    expect(hits).toBeGreaterThanOrEqual(TARGET_HITS);
  }, 120_000);
});
