import { loadOwnedThread } from "@/features/arena/owned-thread";
import { createThreadExportHandler } from "@/features/arena/thread-export-handler";
import { threadReads } from "@/features/arena/thread-reads";
import { utcDay } from "@/infrastructure/day-key";

type RouteContext = { params: Promise<{ threadId: string }> };

const exportThread = createThreadExportHandler({
  loadOwnedThread: (threadId) => loadOwnedThread(threadId, threadReads),
  today: () => utcDay(new Date()),
});

/** The signed-in person's own thread as a Markdown file. */
export const GET = async (_request: Request, { params }: RouteContext) =>
  exportThread((await params).threadId);
