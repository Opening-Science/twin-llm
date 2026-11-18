import type { AppendInput } from "@/packages/audit/append";

/**
 * `DELETE /api/threads/<id>` (SERVER-SPEC 3.8). The thread bar calls it once
 * its undo window has run out. Someone else's thread, or one that does not
 * exist, gets the same 404 and no audit row. The delete is scoped to the
 * id and the owner; turns, answers, search embeddings and any scheduled task
 * bound to the thread go with it. The audit row holds ids and a count only.
 */

export type ThreadDeleteDeps = Readonly<{
  actorId: () => Promise<string | null>;
  appUserIdFor: (actorId: string) => Promise<string | null>;
  /** Turns deleted, or null when no thread with that id is the user's. */
  deleteOwnedThread: (userId: string, threadId: string) => Promise<number | null>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

const NO_STORE = { "cache-control": "no-store" } as const;

const notFound = (): Response =>
  Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

export const createThreadDeleteHandler =
  (deps: ThreadDeleteDeps) =>
  async (threadId: string): Promise<Response> => {
    const actor = await deps.actorId();
    if (actor === null) return notFound();
    const userId = await deps.appUserIdFor(actor);
    if (userId === null) return notFound();
    const turnsDeleted = await deps.deleteOwnedThread(userId, threadId);
    if (turnsDeleted === null) return notFound();
    await deps.appendAudit({
      actor,
      sessionId: threadId,
      subjectRef: null,
      tool: "thread.delete",
      args: { threadId },
      result: { turnsDeleted },
      rowCount: turnsDeleted,
    });
    return Response.json({ ok: true, turnsDeleted }, { headers: NO_STORE });
  };
