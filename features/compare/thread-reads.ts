import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { statusOf } from "@/infrastructure/answer-state";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";

import type { OwnedThread } from "./conversation";
import { loadOwnedThread, type StoredThread, type ThreadReads } from "./owned-thread";

/**
 * The real reads behind `loadOwnedThread`, and the page form of it: cached
 * per request so the thread layout and page read once, and a 404 for
 * anything the viewer may not read. The conversation is read from the new
 * chat tables and handed on under the app's own names, still sealed.
 */
const readThread = async (threadId: string): Promise<StoredThread | null> => {
  const row = await database().conversation.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      ownerId: true,
      titleSealed: true,
      exchanges: {
        orderBy: { askedAt: "asc" },
        select: {
          id: true,
          questionSealed: true,
          skillName: true,
          bubbleTextSealed: true,
          origin: true,
          answers: {
            orderBy: { openedAt: "asc" },
            select: {
              id: true,
              answererRef: true,
              answererLabel: true,
              columnIndex: true,
              state: true,
              bodySealed: true,
              reasoningSealed: true,
              evidenceSealed: true,
              documentSealed: true,
              toolTraceSealed: true,
              firstTokenMs: true,
              tokensPerSecond: true,
              inputTokens: true,
              outputTokens: true,
              totalTokens: true,
              costUsd: true,
              closedAt: true,
            },
          },
        },
      },
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    userId: row.ownerId,
    title: row.titleSealed,
    turns: row.exchanges.map((exchange) => ({
      id: exchange.id,
      prompt: exchange.questionSealed,
      skill: exchange.skillName,
      label: exchange.bubbleTextSealed,
      scheduled: exchange.origin === "schedule",
      responses: exchange.answers.map((answer) => ({
        id: answer.id,
        modelId: answer.answererRef,
        modelName: answer.answererLabel,
        position: answer.columnIndex,
        status: statusOf(answer.state),
        text: answer.bodySealed,
        reasoningText: answer.reasoningSealed,
        attribution: answer.evidenceSealed,
        responseDocument: answer.documentSealed,
        toolParts: answer.toolTraceSealed,
        timeToFirstTokenMs: answer.firstTokenMs,
        tokensPerSecond: answer.tokensPerSecond,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        totalTokens: answer.totalTokens,
        costUsd: answer.costUsd,
        completedAt: answer.closedAt,
      })),
    })),
  };
};

export const threadReads: ThreadReads = {
  actorId: resolveActorId,
  appUserIdFor: findAppUserId,
  cipherFor: cipherForUser,
  readThread,
};

export const ownedThread = cache(
  async (threadId: string): Promise<OwnedThread> =>
    (await loadOwnedThread(threadId, threadReads)) ?? notFound(),
);
