import { exportStep } from "@/features/compare/export-notice";
import { loadOwnedThread } from "@/features/compare/owned-thread";
import {
  createThreadExportHandler,
  exportFormat,
} from "@/features/compare/thread-export-handler";
import { threadReads } from "@/features/compare/thread-reads";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { utcDay } from "@/infrastructure/day-key";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { serverEnv } from "@/infrastructure/env";
import { freeTextCheckerFor } from "@/infrastructure/free-text-check-runtime";
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
  freeTextChecker: freeTextCheckerFor,
  dataMode: () => serverEnv().DATA_MODE,
  today: () => utcDay(new Date()),
});

/**
 * The signed-in person's own thread as Markdown, or `?format=fhir` as a
 * DocumentReference: `?check=1` answers the notice, `?confirm=1` makes the file (#531).
 */
export const GET = withUnlocked(async (request: Request, { params }: RouteContext) => {
  const search = new URL(request.url).searchParams;
  return exportThread(
    (await params).threadId,
    exportFormat(search.get("format")),
    exportStep(search),
  );
});
