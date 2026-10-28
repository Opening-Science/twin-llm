import { formatDate } from "@/infrastructure/format-measure";
import { genomeThreadRefusedEvent } from "@/infrastructure/genome-thread-audit";
import {
  GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL,
  GENOME_THREAD_SENTENCE,
  historyShowsGenome,
  permitGenomeThreadExport,
  toolPartsUseGenome,
} from "@/infrastructure/genome-thread-policy";
import { readableTitle } from "@/infrastructure/readable-title";
import type { AppendInput } from "@/packages/audit/append";

import {
  exportFileName,
  type ExportableThread,
  threadDocumentReference,
  threadMarkdown,
} from "./thread-markdown";
import { threadPrintHtml } from "./thread-print";

/**
 * `GET /api/threads/<id>/export[?format=fhir|print]`: the viewer's own thread
 * as a Markdown file, as a FHIR R4 DocumentReference carrying that same
 * Markdown (#44), or as a page for printing or saving as PDF (#213). Anyone else, or a thread that does not exist, gets the same 404, as
 * the thread page does.
 *
 * Every export writes an audit row (the format and the size; no content). A
 * thread that used the genome tools leaves only for a recipient on this
 * machine: with the app served on loopback only (`LOCAL_ONLY`), the
 * download lands on the same machine; otherwise it is refused and audited
 * (`genome-thread-policy.ts`).
 */
export type ThreadExportDeps = Readonly<{
  /** The thread when the signed-in viewer owns it, else null. */
  loadOwnedThread: (threadId: string) => Promise<ExportableThread | null>;
  actorId: () => Promise<string | null>;
  /** True when the app is served to this machine only. */
  recipientIsLocal: () => boolean;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  today: () => string;
}>;

export const THREAD_EXPORT_AUDIT_TOOL = "thread.export" as const;

export type ExportFormat = "markdown" | "fhir" | "print";

export const exportFormat = (value: string | null): ExportFormat =>
  value === "fhir" || value === "print" ? value : "markdown";

const NO_STORE = { "Cache-Control": "no-store" };

const usesGenome = (thread: ExportableThread): boolean =>
  thread.turns.some(
    (turn) =>
      historyShowsGenome([{ role: "user", content: turn.prompt }]) ||
      turn.answers.some((answer) => toolPartsUseGenome(answer.tools ?? [])),
  );

export const createThreadExportHandler =
  (deps: ThreadExportDeps) =>
  async (threadId: string, format: ExportFormat = "markdown"): Promise<Response> => {
    const thread = await deps.loadOwnedThread(threadId);
    const actor = await deps.actorId();
    if (thread === null || actor === null) {
      return new Response("Not found", { status: 404, headers: NO_STORE });
    }
    const decision = permitGenomeThreadExport({
      genomeThread: usesGenome(thread),
      recipientIsLocal: deps.recipientIsLocal(),
    });
    if (!decision.ok) {
      await deps.appendAudit(
        genomeThreadRefusedEvent({
          actor,
          sessionId: threadId,
          threadId,
          provider: "download",
          tool: GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL,
        }),
      );
      return new Response(GENOME_THREAD_SENTENCE, { status: 403, headers: NO_STORE });
    }

    const markdown = threadMarkdown(thread, formatDate(deps.today()));
    const body =
      format === "fhir"
        ? JSON.stringify(threadDocumentReference(thread, markdown, deps.today()), null, 2)
        : format === "print"
          ? threadPrintHtml(markdown, readableTitle(thread.title))
          : markdown;
    await deps.appendAudit({
      actor,
      sessionId: threadId,
      subjectRef: null,
      tool: THREAD_EXPORT_AUDIT_TOOL,
      // The audit log keeps only hashes of these; the content itself is never logged.
      args: { format },
      result: { bytes: body.length },
      rowCount: thread.turns.reduce((sum, turn) => sum + turn.answers.length, 0),
    });
    if (format === "print") {
      return new Response(body, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
      });
    }
    const fileName = exportFileName(thread.title);
    return new Response(body, {
      headers: {
        "Content-Type":
          format === "fhir"
            ? "application/fhir+json; charset=utf-8"
            : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${
          format === "fhir" ? fileName.replace(/\.md$/, ".fhir.json") : fileName
        }"`,
        ...NO_STORE,
      },
    });
  };
