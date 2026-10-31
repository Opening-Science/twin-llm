import type { AppendInput } from "@/packages/audit/append";

/**
 * `DELETE /api/threads/<id>`: deletes the signed-in viewer's own thread, its
 * turns, answers and search embeddings (all cascade from the thread row).
 * Anyone else, or a thread that does not exist, gets the same 404 as the
 * thread page, so the route does not confirm that a thread exists.
 *
 * The thread bar asks for this only when its undo window has run out
 * (`infrastructure/ui-kit/soft-delete.ts`), so Undo never reaches the server
 * and only a real delete writes an audit row: the number of turns deleted,
 * no title or content.
 */
export type ThreadDeleteDeps = Readonly<{
  actorId: () => Promise<string | null>;
  appUserIdFor: (actorId: string) => Promise<string | null>;
  /** Turns deleted with the thread, or null when the user owns no such thread. */
  deleteOwnedThread: (userId: string, threadId: string) => Promise<number | null>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

export const THREAD_DELETE_AUDIT_TOOL = "thread.delete" as const;

const NO_STORE = { "Cache-Control": "no-store" };

const notFound = () =>
  Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

export const createThreadDeleteHandler =
  (deps: ThreadDeleteDeps) =>
  async (threadId: string): Promise<Response> => {
    const actor = await deps.actorId();
    if (actor === null) return notFound();
    const userId = await deps.appUserIdFor(actor);
    if (userId === null) return notFound();
    const turns = await deps.deleteOwnedThread(userId, threadId);
    if (turns === null) return notFound();
    await deps.appendAudit({
      actor,
      sessionId: threadId,
      subjectRef: null,
      tool: THREAD_DELETE_AUDIT_TOOL,
      args: { thread_id: threadId },
      result: { turns_deleted: turns },
      rowCount: turns,
    });
    return Response.json({ ok: true, turnsDeleted: turns }, { headers: NO_STORE });
  };
