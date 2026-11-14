import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";

import type { OwnedThread } from "./conversation";
import { loadOwnedThread, type ThreadReads } from "./owned-thread";

/**
 * The real reads behind `loadOwnedThread`, and the page form of it: cached
 * per request so the thread layout and page read once, and a 404 for
 * anything the viewer may not read.
 */
export const threadReads: ThreadReads = {
  actorId: resolveActorId,
  appUserIdFor: findAppUserId,
  cipherFor: cipherForUser,
  readThread: (threadId) =>
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
            skill: true,
            label: true,
            scheduled: true,
            responses: {
              orderBy: { createdAt: "asc" },
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
    }),
};

export const ownedThread = cache(
  async (threadId: string): Promise<OwnedThread> =>
    (await loadOwnedThread(threadId, threadReads)) ?? notFound(),
);
