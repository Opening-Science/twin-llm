import "server-only";

import { cache } from "react";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";

import {
  type OwnedThread,
  requireOwnedThread,
  type StoredThread,
  type ThreadReads,
} from "./owned-thread";

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

export const threadReads: ThreadReads = {
  actorId: resolveActorId,
  appUserIdFor: findAppUserId,
  findThread,
};

/**
 * The thread behind `/t/<id>`, read once per request: the layout checks it
 * (and 404s) before anything streams, and the page gets the same result.
 */
export const ownedThread = cache((threadId: string): Promise<OwnedThread> =>
  requireOwnedThread(threadId, threadReads),
);
