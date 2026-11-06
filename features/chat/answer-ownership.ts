import "server-only";

import type { ModelResponseStatus } from "@/generated/prisma/client";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";

export type AnswerOwnership =
  | Readonly<{
      kind: "owner";
      appUserId: string;
      modelName: string;
      status: ModelResponseStatus;
    }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "someone-else" }>;

/** The turn's thread must belong to the person making the call. */
export const answerOwnership = async (
  actorId: string,
  answer: Readonly<{ turnId: string; modelId: string }>,
): Promise<AnswerOwnership> => {
  const row = await database().modelResponse.findUnique({
    where: { turnId_modelId: { turnId: answer.turnId, modelId: answer.modelId } },
    select: {
      modelName: true,
      status: true,
      turn: { select: { thread: { select: { userId: true } } } },
    },
  });
  if (row === null) return { kind: "missing" };
  const appUserId = await findAppUserId(actorId);
  return appUserId !== null && row.turn.thread.userId === appUserId
    ? { kind: "owner", appUserId, modelName: row.modelName, status: row.status }
    : { kind: "someone-else" };
};
