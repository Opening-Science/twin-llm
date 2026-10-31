import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";
import { type FieldCipher, openJson, sealJson } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import {
  LOCAL_ONLY_AUDIT_TOOLS,
  toolPartsUseGenome,
} from "@/infrastructure/genome-thread-policy";
import { defaultEmbedPorts, embedText } from "@/packages/guidelines/embed";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "@/packages/guidelines/constants";
import {
  openPrompt,
  openResponse,
  openThreadTitle,
} from "@/infrastructure/thread-fields";

import type {
  IndexPorts,
  IndexSource,
  NearestRow,
  SourceText,
  ThreadSearchPorts,
  WordRow,
} from "./thread-search";

/**
 * The database and Ollama behind `thread-search.ts`. Every read filters on
 * the owner. The two vector statements are fixed SQL, like the guideline
 * store's: Prisma has no syntax for pgvector.
 *
 * Embeddings are always computed on this machine: the origin must be a
 * loopback address whatever LOCAL_ONLY says, because what is embedded is the
 * person's own prompts and answers.
 *
 * Personal installs (#141): titles, prompts, answers and vectors are sealed,
 * so SQL can neither match words in them nor rank vectors. Both searches then
 * read the person's own rows, open them after unlock and match or rank in
 * memory (a person's threads give thousands of rows, not millions).
 * Synthetic installs keep the SQL `ILIKE` and the pgvector HNSW index.
 */

const EMBEDDINGS = "thread_search_embeddings";

const containsInsensitive = (text: string, query: string): boolean =>
  text.toLocaleLowerCase().includes(query.toLocaleLowerCase());

/** Cosine distance, as pgvector's `<=>`: 1 - cos(a, b); 1 for a zero vector. */
export const cosineDistance = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 1 : 1 - dot / Math.sqrt(normA * normB);
};

const isVector = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number");

const embedPorts = () => ({ ...defaultEmbedPorts(), requireLoopback: true });

const vectorSql = (values: readonly number[]): Prisma.Sql =>
  Prisma.raw(
    `'[${values.map((value) => (Number.isFinite(value) ? String(value) : "0")).join(",")}]'::vector`,
  );

const insensitive = (query: string) => ({
  contains: query,
  mode: "insensitive" as const,
});

/** Every title, prompt and finished answer of one person, opened, newest first. */
const sealedWordRows = async (
  userId: string,
  cipher: FieldCipher,
  query: string,
  cap: number,
): Promise<readonly WordRow[]> => {
  const db = database();
  const threads = await db.thread.findMany({
    where: { userId },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const byId = new Map(
    threads.map((thread) => [
      thread.id,
      {
        threadId: thread.id,
        title: openThreadTitle(cipher, thread.id, thread.title),
        updatedAt: thread.updatedAt,
      },
    ]),
  );
  const [turns, answers] = await Promise.all([
    db.turn.findMany({
      where: { thread: { userId } },
      select: { id: true, threadId: true, prompt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.modelResponse.findMany({
      where: { status: "COMPLETE", turn: { thread: { userId } } },
      select: { id: true, text: true, turn: { select: { threadId: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const withThread = (threadId: string, text: string | null): WordRow[] => {
    const thread = byId.get(threadId);
    return thread === undefined ? [] : [{ ...thread, text }];
  };
  return [
    ...[...byId.values()]
      .filter((thread) => containsInsensitive(thread.title, query))
      .slice(0, cap)
      .map((thread) => ({ ...thread, text: null })),
    ...turns
      .map((turn) => ({ ...turn, prompt: openPrompt(cipher, turn.id, turn.prompt) }))
      .filter((turn) => containsInsensitive(turn.prompt, query))
      .slice(0, cap)
      .flatMap((turn) => withThread(turn.threadId, turn.prompt)),
    ...answers
      .map((answer) => openResponse(cipher, answer))
      .filter((answer) => containsInsensitive(answer.text, query))
      .slice(0, cap)
      .flatMap((answer) => withThread(answer.turn.threadId, answer.text)),
  ];
};

const wordRows = async (
  userId: string,
  query: string,
  cap: number,
): Promise<readonly WordRow[]> => {
  const cipher = await cipherForUser(userId);
  if (cipher.mode === "sealed") return sealedWordRows(userId, cipher, query, cap);
  const db = database();
  const threadFields = { id: true, title: true, updatedAt: true } as const;
  const [titles, prompts, answers] = await Promise.all([
    db.thread.findMany({
      where: { userId, title: insensitive(query) },
      select: threadFields,
      orderBy: { updatedAt: "desc" },
      take: cap,
    }),
    db.turn.findMany({
      where: { thread: { userId }, prompt: insensitive(query) },
      select: { prompt: true, thread: { select: threadFields } },
      orderBy: { createdAt: "desc" },
      take: cap,
    }),
    db.modelResponse.findMany({
      where: {
        status: "COMPLETE",
        turn: { thread: { userId } },
        text: insensitive(query),
      },
      select: { text: true, turn: { select: { thread: { select: threadFields } } } },
      orderBy: { createdAt: "desc" },
      take: cap,
    }),
  ]);
  return [
    ...titles.map((thread) => ({
      threadId: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      text: null,
    })),
    ...prompts.map((turn) => ({
      threadId: turn.thread.id,
      title: turn.thread.title,
      updatedAt: turn.thread.updatedAt,
      text: turn.prompt,
    })),
    ...answers.map((answer) => ({
      threadId: answer.turn.thread.id,
      title: answer.turn.thread.title,
      updatedAt: answer.turn.thread.updatedAt,
      text: answer.text,
    })),
  ];
};

/** Personal mode: the person's sealed vectors, opened and ranked in memory. */
const sealedNearest = async (
  userId: string,
  cipher: FieldCipher,
  vector: readonly number[],
  cap: number,
): Promise<readonly NearestRow[]> => {
  const rows = await database().threadSearchEmbedding.findMany({
    where: { userId, embeddingSealed: { not: null } },
    select: {
      id: true,
      threadId: true,
      sourceKind: true,
      sourceId: true,
      embeddingSealed: true,
    },
  });
  return rows
    .flatMap((row): NearestRow[] => {
      if (row.embeddingSealed === null) return [];
      const { sourceKind } = row;
      if (sourceKind !== "prompt" && sourceKind !== "answer") return [];
      const stored = openJson(
        cipher,
        EMBEDDINGS,
        "embedding_sealed",
        row.id,
        row.embeddingSealed,
      );
      if (!isVector(stored)) return [];
      return [
        {
          threadId: row.threadId,
          sourceKind,
          sourceId: row.sourceId,
          distance: cosineDistance(stored, vector),
        },
      ];
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, cap);
};

const nearest = async (
  userId: string,
  vector: readonly number[],
  cap: number,
): Promise<readonly NearestRow[]> => {
  if (vector.length !== EMBEDDING_DIM) return [];
  const cipher = await cipherForUser(userId);
  if (cipher.mode === "sealed") return sealedNearest(userId, cipher, vector, cap);
  const rows = await database().$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    return tx.$queryRaw<
      { threadId: string; sourceKind: string; sourceId: string; distance: number }[]
    >(Prisma.sql`
      WITH nearest AS MATERIALIZED (
        SELECT thread_id AS "threadId", source_kind AS "sourceKind",
               source_id AS "sourceId", embedding <=> ${vectorSql(vector)} AS distance
        FROM thread_search_embeddings
        WHERE user_id = ${userId}
        ORDER BY embedding <=> ${vectorSql(vector)}
        LIMIT ${cap}
      )
      SELECT "threadId", "sourceKind", "sourceId", distance FROM nearest ORDER BY distance
    `);
  });
  return rows.flatMap((row) =>
    row.sourceKind === "prompt" || row.sourceKind === "answer"
      ? [{ ...row, sourceKind: row.sourceKind, distance: Number(row.distance) }]
      : [],
  );
};

const sourceTexts = async (
  userId: string,
  rows: readonly NearestRow[],
): Promise<ReadonlyMap<string, SourceText>> => {
  const db = database();
  const ids = (kind: NearestRow["sourceKind"]) =>
    rows.filter((row) => row.sourceKind === kind).map((row) => row.sourceId);
  const threadFields = { id: true, title: true, updatedAt: true } as const;
  const cipher = await cipherForUser(userId);
  const opened = <T extends Readonly<{ id: string; title: string }>>(thread: T): T => ({
    ...thread,
    title: openThreadTitle(cipher, thread.id, thread.title),
  });
  const [prompts, answers] = await Promise.all([
    db.turn
      .findMany({
        where: { id: { in: ids("prompt") }, thread: { userId } },
        select: { id: true, prompt: true, thread: { select: threadFields } },
      })
      .then((rows) =>
        rows.map((turn) => ({
          ...turn,
          prompt: openPrompt(cipher, turn.id, turn.prompt),
          thread: opened(turn.thread),
        })),
      ),
    db.modelResponse
      .findMany({
        where: { id: { in: ids("answer") }, turn: { thread: { userId } } },
        select: {
          id: true,
          text: true,
          turn: { select: { thread: { select: threadFields } } },
        },
      })
      .then((rows) =>
        rows.map((answer) => ({
          ...openResponse(cipher, answer),
          turn: { thread: opened(answer.turn.thread) },
        })),
      ),
  ]);
  return new Map([
    ...prompts.map(
      (turn) =>
        [
          `prompt:${turn.id}`,
          {
            threadId: turn.thread.id,
            title: turn.thread.title,
            updatedAt: turn.thread.updatedAt,
            text: turn.prompt,
          },
        ] as const,
    ),
    ...answers.map(
      (answer) =>
        [
          `answer:${answer.id}`,
          {
            threadId: answer.turn.thread.id,
            title: answer.turn.thread.title,
            updatedAt: answer.turn.thread.updatedAt,
            text: answer.text,
          },
        ] as const,
    ),
  ]);
};

/**
 * Genome threads among these (#151): a stored genome or imported-data tool
 * part in any answer, or such a row in the audit chain for any of their turns.
 */
const genomeThreads = async (
  threadIds: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (threadIds.length === 0) return new Set();
  const db = database();
  const turns = await db.turn.findMany({
    where: { threadId: { in: [...threadIds] } },
    select: {
      id: true,
      threadId: true,
      thread: { select: { userId: true } },
      responses: { select: { id: true, toolParts: true } },
    },
  });
  const ciphers = new Map<string, FieldCipher>();
  for (const userId of new Set(turns.map((turn) => turn.thread.userId))) {
    ciphers.set(userId, await cipherForUser(userId));
  }
  const usesGenome = (turn: (typeof turns)[number]): boolean => {
    const cipher = ciphers.get(turn.thread.userId);
    return (
      cipher !== undefined &&
      turn.responses.some((row) =>
        toolPartsUseGenome(openResponse(cipher, row).toolParts),
      )
    );
  };
  const found = new Set(turns.filter(usesGenome).map((turn) => turn.threadId));
  const rest = turns.filter((turn) => !found.has(turn.threadId));
  if (rest.length > 0) {
    const audited = await db.auditEvent.findMany({
      where: {
        sessionId: { in: rest.map((turn) => turn.id) },
        tool: { in: [...LOCAL_ONLY_AUDIT_TOOLS] },
      },
      select: { sessionId: true },
      distinct: ["sessionId"],
    });
    const threadOf = new Map(rest.map((turn) => [turn.id, turn.threadId]));
    for (const row of audited) {
      const threadId = threadOf.get(row.sessionId);
      if (threadId !== undefined) found.add(threadId);
    }
  }
  return found;
};

export const threadSearchPorts = (): ThreadSearchPorts => ({
  wordRows,
  embedQuery: (query) => embedText(query, "query", embedPorts()),
  nearest,
  sourceTexts,
  genomeThreads,
});

const recentSources = async (
  userId: string,
  cap: number,
): Promise<readonly IndexSource[]> => {
  const db = database();
  const [turns, answers] = await Promise.all([
    db.turn.findMany({
      where: { thread: { userId } },
      select: { id: true, threadId: true, prompt: true },
      orderBy: { createdAt: "desc" },
      take: cap,
    }),
    db.modelResponse.findMany({
      where: { status: "COMPLETE", turn: { thread: { userId } } },
      select: { id: true, text: true, turn: { select: { threadId: true } } },
      orderBy: { createdAt: "desc" },
      take: cap,
    }),
  ]);
  const cipher = await cipherForUser(userId);
  return [
    ...turns.map((turn) => ({
      threadId: turn.threadId,
      sourceKind: "prompt" as const,
      sourceId: turn.id,
      text: openPrompt(cipher, turn.id, turn.prompt),
    })),
    ...answers.map((answer) => ({
      threadId: answer.turn.threadId,
      sourceKind: "answer" as const,
      sourceId: answer.id,
      text: openResponse(cipher, answer).text,
    })),
  ];
};

const indexedKeys = async (
  sources: readonly IndexSource[],
): Promise<ReadonlySet<string>> => {
  if (sources.length === 0) return new Set();
  const rows = await database().threadSearchEmbedding.findMany({
    where: { sourceId: { in: sources.map((source) => source.sourceId) } },
    select: { sourceKind: true, sourceId: true },
  });
  return new Set(rows.map((row) => `${row.sourceKind}:${row.sourceId}`));
};

export const indexPorts = (): IndexPorts => ({
  recentSources,
  indexedKeys,
  genomeThreads,
  dropThreads: async (userId, threadIds) => {
    await database().threadSearchEmbedding.deleteMany({
      where: { userId, threadId: { in: [...threadIds] } },
    });
  },
  embedDocument: (text) => embedText(text, "document", embedPorts()),
  store: async (userId, source, vector) => {
    if (vector.length !== EMBEDDING_DIM) return;
    const cipher = await cipherForUser(userId);
    if (cipher.mode === "sealed") {
      // Personal mode: the vector is sealed; no plain vector is written.
      const id = randomUUID();
      await database().$executeRaw(Prisma.sql`
        INSERT INTO thread_search_embeddings
          (id, user_id, thread_id, source_kind, source_id, model, embedding_sealed)
        VALUES (${id}, ${userId}, ${source.threadId}, ${source.sourceKind},
                ${source.sourceId}, ${EMBEDDING_MODEL},
                ${sealJson(cipher, EMBEDDINGS, "embedding_sealed", id, vector)})
        ON CONFLICT (source_kind, source_id) DO NOTHING
      `);
      return;
    }
    await database().$executeRaw(Prisma.sql`
      INSERT INTO thread_search_embeddings
        (id, user_id, thread_id, source_kind, source_id, model, embedding)
      VALUES (${randomUUID()}, ${userId}, ${source.threadId}, ${source.sourceKind},
              ${source.sourceId}, ${EMBEDDING_MODEL}, ${vectorSql(vector)})
      ON CONFLICT (source_kind, source_id) DO NOTHING
    `);
  },
  now: () => Date.now(),
});
