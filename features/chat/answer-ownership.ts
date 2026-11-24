import "server-only";

import { type AnswerStatus, statusOf } from "@/infrastructure/answer-state";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";

export type AnswerOwnership =
  | Readonly<{
      kind: "owner";
      appUserId: string;
      modelName: string;
      status: AnswerStatus;
    }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "someone-else" }>;

/** The turn's thread must belong to the person making the call. */
export const answerOwnership = async (
  actorId: string,
  answer: Readonly<{ turnId: string; modelId: string }>,
): Promise<AnswerOwnership> => {
  const row = await database().answer.findUnique({
    where: {
      exchangeId_answererRef: { exchangeId: answer.turnId, answererRef: answer.modelId },
    },
    select: {
      answererLabel: true,
      state: true,
      exchange: { select: { conversation: { select: { ownerId: true } } } },
    },
  });
  if (row === null) return { kind: "missing" };
  const appUserId = await findAppUserId(actorId);
  return appUserId !== null && row.exchange.conversation.ownerId === appUserId
    ? {
        kind: "owner",
        appUserId,
        modelName: row.answererLabel,
        status: statusOf(row.state),
      }
    : { kind: "someone-else" };
};
