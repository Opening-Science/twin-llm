import "server-only";

import { database } from "@/infrastructure/database";

import { type ThreadView, threadViewsOf } from "./thread-views";

/**
 * The views of the thread a turn belongs to. A chat turn's audit session is
 * its turn id, so that is the key. Only finished answers are read; the turn
 * that asks has no stored parts yet.
 */
export const loadThreadViews = async (turnId: string): Promise<ThreadView[]> => {
  const turn = await database().turn.findUnique({
    where: { id: turnId },
    select: { threadId: true },
  });
  if (turn === null) return [];
  const rows = await database().modelResponse.findMany({
    where: { status: "COMPLETE", turn: { threadId: turn.threadId } },
    select: {
      modelName: true,
      toolParts: true,
      responseDocument: true,
      completedAt: true,
    },
  });
  return threadViewsOf(rows);
};
