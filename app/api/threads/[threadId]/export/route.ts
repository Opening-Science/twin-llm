import { loadOwnedThread } from "@/features/arena/owned-thread";
import {
  createThreadExportHandler,
  exportFormat,
} from "@/features/arena/thread-export-handler";
import { threadReads } from "@/features/arena/thread-reads";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { utcDay } from "@/infrastructure/day-key";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { serverEnv } from "@/infrastructure/env";
import { database } from "@/infrastructure/database";
import { append } from "@/packages/audit/append";
import { withUnlocked } from "@/infrastructure/vault-runtime";

type RouteContext = { params: Promise<{ threadId: string }> };

const exportThread = createThreadExportHandler({
  loadOwnedThread: (threadId) => loadOwnedThread(threadId, threadReads),
  actorId: resolveActorId,
  recipientIsLocal: () => serverEnv().LOCAL_ONLY,
  appendAudit: (input) => append(database(), input),
  recordDisclosure,
  dataMode: () => serverEnv().DATA_MODE,
  today: () => utcDay(new Date()),
});

/** The signed-in person's own thread as Markdown, or `?format=fhir` as a DocumentReference. */
export const GET = withUnlocked(async (request: Request, { params }: RouteContext) =>
  exportThread(
    (await params).threadId,
    exportFormat(new URL(request.url).searchParams.get("format")),
  ),
);
