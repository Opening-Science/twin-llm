import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";

import type { StoredThread, ThreadReads } from "./owned-thread";

/** The real reads behind `loadOwnedThread`: the actor, their user row, and the thread. */
const findThread = (threadId: string): Promise<StoredThread | null> =>
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
          responses: {
            select: {
              id: true,
              modelId: true,
              modelName: true,
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
            },
          },
        },
      },
    },
  });

export const threadReads: ThreadReads = {
  actorId: resolveActorId,
  appUserIdFor: findAppUserId,
  findThread,
};
