import { createThreadDeleteHandler } from "@/features/arena/thread-delete-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { withUnlocked } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

type RouteContext = { params: Promise<{ threadId: string }> };

const deleteThread = createThreadDeleteHandler({
  actorId: resolveActorId,
  appUserIdFor: findAppUserId,
  deleteOwnedThread: (userId, threadId) =>
    database().$transaction(async (tx) => {
      const turns = await tx.turn.count({ where: { threadId, thread: { userId } } });
      const { count } = await tx.thread.deleteMany({ where: { id: threadId, userId } });
      return count === 0 ? null : turns;
    }),
  appendAudit: (input) => append(database(), input),
});

/** Deletes the signed-in person's own thread; the thread bar calls it after its undo window. */
export const DELETE = withUnlocked(async (_request: Request, { params }: RouteContext) =>
  deleteThread((await params).threadId),
);
