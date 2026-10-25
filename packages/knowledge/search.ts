import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";
import { append } from "@/packages/audit/append";
import { embedText, type EmbedPorts } from "@/packages/guidelines/embed";
import type { GuidelineSearchInput } from "@/packages/guidelines/input";
import {
  queryNearestChunks,
  type GuidelineJoinedRow,
} from "@/packages/guidelines/search";
import type { SessionScope } from "@/packages/query-tools/scope";

import { recordKnowledgeTurn, type KnowledgeCitation } from "./collector";
import { KNOWLEDGE_AUDIT_TOOL, KNOWLEDGE_SOURCE } from "./constants";

export type KnowledgeHit = {
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly sectionHeading: string;
  readonly licence: string;
  readonly passage: string;
};

export type KnowledgeSearchPorts = {
  readonly embed: (query: string, ports?: EmbedPorts) => Promise<number[] | null>;
  readonly search: (
    embedding: readonly number[],
    k: number,
  ) => Promise<readonly GuidelineJoinedRow[]>;
  readonly append: typeof append;
  readonly database: () => PrismaClient;
};

export const toKnowledgeHit = (row: GuidelineJoinedRow): KnowledgeHit => ({
  id: row.documentId,
  title: row.title,
  file: row.url,
  sectionHeading: row.sectionHeading,
  licence: row.licence,
  passage: row.text,
});

export const toKnowledgeCitation = (hit: KnowledgeHit): KnowledgeCitation => ({
  tool: KNOWLEDGE_AUDIT_TOOL,
  id: hit.id,
  title: hit.title,
  file: hit.file,
  sectionHeading: hit.sectionHeading,
  licence: hit.licence,
});

export const defaultKnowledgeSearchPorts = (): KnowledgeSearchPorts => ({
  embed: (query) => embedText(query, "query"),
  search: (embedding, k) =>
    queryNearestChunks(database(), embedding, k, KNOWLEDGE_SOURCE),
  append,
  database,
});

/**
 * Always audited, like guideline search. A failure stores a marker only,
 * never the error text, and returns no hits.
 */
export const runKnowledgeSearch = async (
  scope: SessionScope,
  input: GuidelineSearchInput,
  ports: KnowledgeSearchPorts = defaultKnowledgeSearchPorts(),
): Promise<KnowledgeHit[]> => {
  let hits: KnowledgeHit[] = [];
  let result: unknown = [];
  try {
    const embedding = await ports.embed(input.query);
    if (!embedding) {
      result = { error: "knowledge-embed-failed" };
    } else {
      hits = (await ports.search(embedding, input.k)).map(toKnowledgeHit);
      result = hits;
    }
  } catch {
    hits = [];
    result = { error: "knowledge-search-failed" };
  }

  await ports.append(ports.database(), {
    actor: scope.actor,
    sessionId: scope.sessionId,
    subjectRef: null,
    tool: KNOWLEDGE_AUDIT_TOOL,
    args: input,
    result,
    rowCount: hits.length,
  });
  recordKnowledgeTurn(scope.sessionId, hits.map(toKnowledgeCitation));
  return hits;
};
