import "server-only";

import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import { openResponse } from "@/infrastructure/thread-fields";

import { type ThreadView, threadViewsOf } from "./thread-views";

/**
 * The views of the thread a turn belongs to. A chat turn's audit session is
 * its turn id, so that is the key. Only finished answers are read; the turn
 * that asks has no stored parts yet.
 */
export const loadThreadViews = async (turnId: string): Promise<ThreadView[]> => {
  const exchange = await database().exchange.findUnique({
    where: { id: turnId },
    select: { conversationId: true, conversation: { select: { ownerId: true } } },
  });
  if (exchange === null) return [];
  const cipher = await cipherForUser(exchange.conversation.ownerId);
  const rows = await database().answer.findMany({
    where: { state: "complete", exchange: { conversationId: exchange.conversationId } },
    select: {
      id: true,
      answererLabel: true,
      toolTraceSealed: true,
      documentSealed: true,
      closedAt: true,
    },
  });
  return threadViewsOf(
    rows.map((row) =>
      openResponse(cipher, {
        id: row.id,
        modelName: row.answererLabel,
        toolParts: row.toolTraceSealed,
        responseDocument: row.documentSealed,
        completedAt: row.closedAt,
      }),
    ),
  );
};
