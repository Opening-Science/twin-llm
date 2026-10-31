import "server-only";

import { cache } from "react";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import {
  openPrompt,
  openResponse,
  openThreadTitle,
} from "@/infrastructure/thread-fields";
import { skillOfAuditTool } from "@/infrastructure/skill-gate";

import {
  type OwnedThread,
  requireOwnedThread,
  type StoredThread,
  type ThreadReads,
} from "./owned-thread";

/**
 * The real reads behind `loadOwnedThread`: the actor, their user row, and the
 * thread. A thread that is not the viewer's is never opened.
 */
const findThread = async (
  threadId: string,
  viewerId: string,
): Promise<StoredThread | null> => {
  const row = await readThread(threadId);
  if (row === null || row.userId !== viewerId) return null;
  const cipher = await cipherForUser(row.userId);
  return {
    ...row,
    title: openThreadTitle(cipher, row.id, row.title),
    turns: row.turns.map((turn) => ({
      ...turn,
      prompt: openPrompt(cipher, turn.id, turn.prompt),
      responses: turn.responses.map((response) => openResponse(cipher, response)),
    })),
  };
};

const readThread = (threadId: string) =>
  database().thread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      userId: true,
      title: true,
      turns: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          prompt: true,
          scheduled: true,
          responses: {
            select: {
              id: true,
              modelId: true,
              modelName: true,
              position: true,
              status: true,
              text: true,
              reasoningText: true,
              attribution: true,
              responseDocument: true,
              toolParts: true,
              timeToFirstTokenMs: true,
              tokensPerSecond: true,
              inputTokens: true,
              outputTokens: true,
              totalTokens: true,
              costUsd: true,
              completedAt: true,
            },
          },
        },
      },
    },
  });

/** `skill.<name>` audit rows of these turns; the session id of a chat row is its turn id. */
const skillsOfTurns = async (
  turnIds: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  if (turnIds.length === 0) return new Map();
  const rows = await database().auditEvent.findMany({
    where: { sessionId: { in: [...turnIds] }, tool: { startsWith: "skill." } },
    orderBy: { seq: "asc" },
    select: { sessionId: true, tool: true },
  });
  return new Map(
    rows.flatMap((row) => {
      const skill = skillOfAuditTool(row.tool);
      return skill === null ? [] : [[row.sessionId, skill] as const];
    }),
  );
};

export const threadReads: ThreadReads = {
  actorId: resolveActorId,
  appUserIdFor: findAppUserId,
  findThread,
  skillsOfTurns,
};

/**
 * The thread behind `/t/<id>`, read once per request: the layout checks it
 * (and 404s) before anything streams, and the page gets the same result.
 */
export const ownedThread = cache((threadId: string): Promise<OwnedThread> =>
  requireOwnedThread(threadId, threadReads),
);
