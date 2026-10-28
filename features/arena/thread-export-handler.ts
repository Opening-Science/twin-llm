import { formatDate } from "@/infrastructure/format-measure";

import { exportFileName, type ExportableThread, threadMarkdown } from "./thread-markdown";

/**
 * `GET /api/threads/<id>/export`: the viewer's own thread as a Markdown file.
 * Anyone else, or a thread that does not exist, gets the same 404, as the
 * thread page does.
 */
export type ThreadExportDeps = Readonly<{
  /** The thread when the signed-in viewer owns it, else null. */
  loadOwnedThread: (threadId: string) => Promise<ExportableThread | null>;
  today: () => string;
}>;

export const createThreadExportHandler =
  (deps: ThreadExportDeps) =>
  async (threadId: string): Promise<Response> => {
    const thread = await deps.loadOwnedThread(threadId);
    if (thread === null) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new Response(threadMarkdown(thread, formatDate(deps.today())), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFileName(thread.title)}"`,
        "Cache-Control": "no-store",
      },
    });
  };
