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
import {
  recordLiteratureTurn,
  toLiteratureCitation,
} from "@/packages/literature/collector";
import { type LiteratureHit, toLiteratureHit } from "@/packages/literature/hit";
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
    sources: readonly string[],
  ) => Promise<readonly GuidelineJoinedRow[]>;
  readonly append: typeof append;
  readonly database: () => PrismaClient;
};

/** A knowledge note, or for an agent's turn a passage of its specialty literature. */
export type KnowledgeSearchHit = KnowledgeHit | LiteratureHit;

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
  search: (embedding, k, sources) =>
    queryNearestChunks(database(), embedding, k, sources),
  append,
  database,
});

/**
 * The sources one search reads: the knowledge notes, plus the agent's
 * `literature:<specialty>` sources (`literatureSourcesForAgent`) on an
 * agent's turn. Never guideline rows.
 */
export const knowledgeSearchSources = (
  literatureSources: readonly string[] = [],
): readonly string[] => [KNOWLEDGE_SOURCE, ...literatureSources];

/**
 * A row as a hit, read by its source: a note, a literature passage from one
 * of the sources asked for, or nothing (any other row is dropped).
 */
export const toKnowledgeSearchHit = (
  row: GuidelineJoinedRow,
  literatureSources: readonly string[],
): KnowledgeSearchHit | null => {
  if (row.source === KNOWLEDGE_SOURCE) return toKnowledgeHit(row);
  return literatureSources.includes(row.source) ? toLiteratureHit(row) : null;
};

const isLiteratureHit = (hit: KnowledgeSearchHit): hit is LiteratureHit =>
  "kind" in hit && hit.kind === "literature";

/**
 * Always audited, like guideline search. A failure stores a marker only,
 * never the error text, and returns no hits. Literature hits are recorded
 * for the turn's `sources.literature`, notes for `sources.knowledge`; both
 * are reference material and never count as data about the person.
 */
export const runKnowledgeSearch = async (
  scope: SessionScope,
  input: GuidelineSearchInput,
  ports: KnowledgeSearchPorts = defaultKnowledgeSearchPorts(),
  literatureSources: readonly string[] = [],
): Promise<KnowledgeSearchHit[]> => {
  let hits: KnowledgeSearchHit[] = [];
  let result: unknown = [];
  try {
    const embedding = await ports.embed(input.query);
    if (!embedding) {
      result = { error: "knowledge-embed-failed" };
    } else {
      const rows = await ports.search(
        embedding,
        input.k,
        knowledgeSearchSources(literatureSources),
      );
      hits = rows.flatMap((row) => toKnowledgeSearchHit(row, literatureSources) ?? []);
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
  recordKnowledgeTurn(
    scope.sessionId,
    hits.flatMap((hit) => (isLiteratureHit(hit) ? [] : [toKnowledgeCitation(hit)])),
  );
  recordLiteratureTurn(
    scope.sessionId,
    hits.flatMap((hit) =>
      isLiteratureHit(hit) ? [toLiteratureCitation(KNOWLEDGE_AUDIT_TOOL, hit)] : [],
    ),
  );
  return hits;
};
